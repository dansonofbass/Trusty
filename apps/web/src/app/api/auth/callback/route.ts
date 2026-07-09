import { NextResponse, type NextRequest } from "next/server";
import { exchangeCode, verifyIdToken } from "@/lib/auth/keycloak";
import {
  PKCE_COOKIE,
  clearPkceCookie,
  sessionFromTokens,
  setSessionCookie,
  type Session,
} from "@/lib/auth/session";

const GRAPH = process.env.GRAPH_SERVICE_INTERNAL_URL ?? "http://graph-service:4001";

/**
 * Redeem an invite against graph-service as the freshly-authenticated user.
 * Creates the mutual FRIENDS_WITH bridge + records the conversion. Returns the
 * inviter's display name on success, or null (any failure is swallowed — an
 * invite hiccup must not break sign-in).
 */
async function redeemInvite(code: string, session: Session): Promise<string | null> {
  try {
    const r = await fetch(`${GRAPH}/api/invites/accept`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-user-id": session.sub,
        ...(session.name ? { "x-user-name": encodeURIComponent(session.name) } : {}),
        ...(session.email ? { "x-user-email": encodeURIComponent(session.email) } : {}),
      },
      body: JSON.stringify({ code }),
      cache: "no-store",
    });
    if (!r.ok) return null;
    const data = (await r.json()) as { ok?: boolean; inviter?: { name?: string } };
    return data.ok && data.inviter?.name ? data.inviter.name : null;
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
  let pkce: { state: string; verifier: string; invite?: string };
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

    // Redeem an invite (if the user arrived from one): befriend the inviter and
    // log the conversion. Best-effort — a failed redemption must never block
    // sign-in. Returns the inviter's name so we can show a warm welcome.
    let landing = appBase;
    if (pkce.invite) {
      const inviter = await redeemInvite(pkce.invite, session);
      if (inviter) {
        landing = `${appBase}/?welcome=1&from=${encodeURIComponent(inviter)}`;
      }
    }

    const res = NextResponse.redirect(landing);
    await setSessionCookie(res, session);
    clearPkceCookie(res);
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "authentication failed";
    return NextResponse.redirect(`${appBase}/?auth_error=${encodeURIComponent(msg)}`);
  }
}
