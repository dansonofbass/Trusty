import { NextResponse, type NextRequest } from "next/server";
import { buildAuthorizationUrl, pkceChallenge, randomToken } from "@/lib/auth/keycloak";
import { setPkceCookie } from "@/lib/auth/session";

/**
 * Start the OIDC authorization-code + PKCE flow: redirect to Keycloak.
 *
 * Carries two optional query params through the round-trip via the short-lived
 * PKCE cookie:
 *  - `invite=<code>` — arriving from a friend's invite link; the callback turns
 *    this into a FRIENDS_WITH bridge once the session exists.
 *  - `register=1` — open Keycloak's registration form directly (invite CTA).
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const invite = url.searchParams.get("invite")?.slice(0, 64) || undefined;
  const register = url.searchParams.get("register") === "1";

  const state = randomToken(16);
  const verifier = randomToken(32);
  const challenge = await pkceChallenge(verifier);
  const res = NextResponse.redirect(buildAuthorizationUrl(state, challenge, { register }));
  setPkceCookie(res, JSON.stringify({ state, verifier, invite }));
  return res;
}
