import { NextResponse, type NextRequest } from "next/server";
import { exchangeCode, verifyIdToken } from "@/lib/auth/keycloak";
import {
  PKCE_COOKIE,
  clearPkceCookie,
  sessionFromTokens,
  setSessionCookie,
  type Session,
} from "@/lib/auth/session";
import { isAdmin } from "@/lib/auth/roles";
import { emitWebEvent } from "@/lib/domainEvents";

const GRAPH = process.env.GRAPH_SERVICE_INTERNAL_URL ?? "http://graph-service:4001";

function identityHeaders(session: Session): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-user-id": session.sub,
    ...(session.name ? { "x-user-name": encodeURIComponent(session.name) } : {}),
    ...(session.email ? { "x-user-email": encodeURIComponent(session.email) } : {}),
  };
}

/**
 * Consume an invite against graph-service as the freshly-authenticated user.
 * Grants `pending_onboarding` access + binds registration origin — but creates
 * NO graph edge (the INVITED edge is deferred to onboarding completion). Returns
 * true if the invite was valid/consumed. Best-effort: a hiccup must not break
 * sign-in.
 */
async function consumeInvite(code: string, session: Session): Promise<boolean> {
  try {
    const r = await fetch(`${GRAPH}/api/invites/accept`, {
      method: "POST",
      headers: identityHeaders(session),
      body: JSON.stringify({ code }),
      cache: "no-store",
    });
    if (!r.ok) return false;
    const data = (await r.json()) as { ok?: boolean };
    return !!data.ok;
  } catch {
    return false;
  }
}

/** Read the user's front-door status to decide where to land them. Admins carry
 * a verified flag so graph-service exempts them from the waitlist gate. */
async function fetchStatus(session: Session): Promise<string | null> {
  try {
    const admin = await isAdmin(session).catch(() => false);
    const r = await fetch(`${GRAPH}/api/access`, {
      method: "GET",
      headers: { ...identityHeaders(session), ...(admin ? { "x-user-admin": "1" } : {}) },
      cache: "no-store",
    });
    if (!r.ok) return null;
    const data = (await r.json()) as { status?: string; onboardingComplete?: boolean };
    if (data.onboardingComplete) return "active";
    return data.status ?? null;
  } catch {
    return null;
  }
}

/** OIDC redirect target: verify state, exchange code, seal the session. */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const appBase = process.env.APP_BASE_URL ?? url.origin;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const pkceRaw = req.cookies.get(PKCE_COOKIE)?.value;

  if (!code || !state || !pkceRaw) {
    return NextResponse.redirect(`${appBase}/api/auth/login`);
  }
  let pkce: { state: string; verifier: string; invite?: string; waitlist?: boolean };
  try {
    pkce = JSON.parse(pkceRaw);
  } catch {
    return NextResponse.redirect(`${appBase}/api/auth/login`);
  }
  if (pkce.state !== state) {
    return NextResponse.redirect(`${appBase}/api/auth/login`);
  }

  try {
    const tokens = await exchangeCode(code, pkce.verifier);
    if (!tokens.id_token) throw new Error("no id_token in token response");
    const claims = await verifyIdToken(tokens.id_token);
    const name = claims.name ?? claims.preferred_username ?? claims.email ?? "Explorer";
    const session = sessionFromTokens(
      { sub: claims.sub, name, email: claims.email },
      tokens,
    );

    // Consume an invite if the user arrived from one (grants onboarding access +
    // binds origin — no graph edge yet). Best-effort: a failure must not block
    // sign-in. Then read the resulting front-door status to route the landing:
    //   active             → Home
    //   pending_onboarding → /onboarding (invited or unlocked)
    //   waitlisted         → /waitlist
    if (pkce.invite) await consumeInvite(pkce.invite, session);
    const status = await fetchStatus(session);
    const landing =
      status === "active"
        ? appBase
        : status === "pending_onboarding"
          ? `${appBase}/onboarding`
          : status === "waitlisted"
            ? `${appBase}/waitlist`
            : appBase; // gating disabled (open mode) → straight to Home

    emitWebEvent("auth.login", session.sub, { landing: status ?? "open", invited: !!pkce.invite });
    const res = NextResponse.redirect(landing);
    await setSessionCookie(res, session);
    clearPkceCookie(res);
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "authentication failed";
    return NextResponse.redirect(`${appBase}/?auth_error=${encodeURIComponent(msg)}`);
  }
}
