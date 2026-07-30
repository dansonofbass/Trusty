import { NextResponse, type NextRequest } from "next/server";
import { buildAuthorizationUrl, pkceChallenge, randomToken } from "@/lib/auth/keycloak";
import { setPkceCookie } from "@/lib/auth/session";

/**
 * Start the OIDC authorization-code + PKCE flow: redirect to Keycloak.
 *
 * Carries state through the round-trip via the short-lived PKCE cookie:
 *  - `invite=<code>` — arriving from a friend's invite link; the callback
 *    consumes it and grants onboarding access once the session exists.
 *  - `waitlist=1` — the visitor chose to join the waitlist (no invite).
 *  - `register=1` — open Keycloak's registration form directly.
 *
 * Invite-only gate: registration is only offered when the visitor arrived with
 * an invite, or explicitly chose the waitlist. A bare `register=1` with neither
 * intent is downgraded to a sign-in (existing accounts can always log in), so
 * the front door stays invite-only without a custom Keycloak SPI.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const invite = url.searchParams.get("invite")?.slice(0, 64) || undefined;
  const waitlist = url.searchParams.get("waitlist") === "1";
  const wantsRegister = url.searchParams.get("register") === "1";
  const register = wantsRegister && (!!invite || waitlist);

  const state = randomToken(16);
  const verifier = randomToken(32);
  const challenge = await pkceChallenge(verifier);
  // Space subdomains: remember which host started the flow so the callback
  // (always on APP_BASE_URL) can land the user back on their space.
  const returnHost = req.headers.get("host") ?? undefined;
  const res = NextResponse.redirect(buildAuthorizationUrl(state, challenge, { register }));
  setPkceCookie(res, JSON.stringify({ state, verifier, invite, waitlist, returnHost }));
  return res;
}
