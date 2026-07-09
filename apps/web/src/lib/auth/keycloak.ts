import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

/**
 * Keycloak OIDC wiring for the BFF.
 *
 * Dual-URL by necessity (Keycloak-in-Docker): the BROWSER is redirected to the
 * public issuer (`localhost:8080`) — which is also the token `iss` — while the
 * web container reaches the back-channel (token + JWKS) over the Docker network
 * (`keycloak:8080`). Front-channel URLs use the public host; back-channel URLs
 * use the internal host. The realm path is shared.
 */
const PUBLIC_ISSUER = (
  process.env.KEYCLOAK_ISSUER ?? "http://localhost:8080/realms/constellation"
).replace(/\/$/, "");
const INTERNAL_BASE = (process.env.KEYCLOAK_INTERNAL_URL ?? "http://keycloak:8080").replace(
  /\/$/,
  "",
);
const APP_BASE_URL = (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const REALM_PATH = new URL(PUBLIC_ISSUER).pathname; // e.g. /realms/constellation

export const oidc = {
  clientId: process.env.KEYCLOAK_CLIENT_ID ?? "constellation-web",
  clientSecret: process.env.KEYCLOAK_CLIENT_SECRET ?? "",
  issuer: PUBLIC_ISSUER,
  redirectUri: `${APP_BASE_URL}/api/auth/callback`,
  postLogoutRedirectUri: APP_BASE_URL,
  // front-channel (browser) — public host
  authorizationEndpoint: `${PUBLIC_ISSUER}/protocol/openid-connect/auth`,
  // Keycloak's dedicated "land straight on the registration form" endpoint —
  // same authorization-code flow, just opens Register instead of Login. Better
  // first-run UX for someone arriving from an invite link.
  registrationEndpoint: `${PUBLIC_ISSUER}/protocol/openid-connect/registrations`,
  endSessionEndpoint: `${PUBLIC_ISSUER}/protocol/openid-connect/logout`,
  // back-channel (server) — internal host
  tokenEndpoint: `${INTERNAL_BASE}${REALM_PATH}/protocol/openid-connect/token`,
  jwksUri: `${INTERNAL_BASE}${REALM_PATH}/protocol/openid-connect/certs`,
};

const jwks = createRemoteJWKSet(new URL(oidc.jwksUri));

export interface TokenSet {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in: number;
  token_type: string;
}

export interface IdClaims extends JWTPayload {
  sub: string;
  email?: string;
  name?: string;
  preferred_username?: string;
}

/** Verify an id_token's signature + iss/aud against Keycloak's JWKS. */
export async function verifyIdToken(idToken: string): Promise<IdClaims> {
  const { payload } = await jwtVerify(idToken, jwks, {
    issuer: oidc.issuer,
    audience: oidc.clientId,
  });
  return payload as IdClaims;
}

/**
 * Verify an access token's SIGNATURE + issuer + expiry against Keycloak's JWKS.
 * Audience isn't checked — Keycloak access tokens commonly carry `aud: account`
 * rather than the client id. Returns the verified claims, or null if the token
 * is forged/expired/unverifiable (callers fail closed). Used for authorization
 * decisions (roles) so we never trust an unverified JWT payload.
 */
export async function verifyAccessToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer: oidc.issuer });
    return payload;
  } catch {
    return null;
  }
}

/* --------------------------------- PKCE --------------------------------- */

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** URL-safe random token (state, PKCE verifier). */
export function randomToken(bytes = 32): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return base64url(a);
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

/* ------------------------------ flow URLs ------------------------------ */

export function buildAuthorizationUrl(
  state: string,
  codeChallenge: string,
  opts: { register?: boolean } = {},
): string {
  const u = new URL(opts.register ? oidc.registrationEndpoint : oidc.authorizationEndpoint);
  u.searchParams.set("client_id", oidc.clientId);
  u.searchParams.set("redirect_uri", oidc.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", "openid profile email");
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

export function buildLogoutUrl(idToken?: string): string {
  const u = new URL(oidc.endSessionEndpoint);
  u.searchParams.set("post_logout_redirect_uri", oidc.postLogoutRedirectUri);
  u.searchParams.set("client_id", oidc.clientId);
  if (idToken) u.searchParams.set("id_token_hint", idToken);
  return u.toString();
}

/* ---------------------------- token requests --------------------------- */

async function tokenRequest(body: URLSearchParams): Promise<TokenSet> {
  const r = await fetch(oidc.tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`token endpoint ${r.status}: ${t.slice(0, 300)}`);
  }
  return (await r.json()) as TokenSet;
}

export function exchangeCode(code: string, codeVerifier: string): Promise<TokenSet> {
  return tokenRequest(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: oidc.redirectUri,
      client_id: oidc.clientId,
      client_secret: oidc.clientSecret,
      code_verifier: codeVerifier,
    }),
  );
}

export function refreshTokens(refreshToken: string): Promise<TokenSet> {
  return tokenRequest(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: oidc.clientId,
      client_secret: oidc.clientSecret,
    }),
  );
}
