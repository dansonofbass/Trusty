import { createHash } from "node:crypto";
import { EncryptJWT, jwtDecrypt } from "jose";
import type { NextRequest, NextResponse } from "next/server";
import { refreshTokens, type TokenSet } from "./keycloak";
import { PKCE_COOKIE, SESSION_COOKIE } from "./constants";

/**
 * BFF session: the user's identity + Keycloak tokens, sealed (JWE) into an
 * httpOnly cookie. Tokens never reach the browser. The cookie is the only
 * thing the client holds; backends are reached through same-origin proxies.
 */
export { PKCE_COOKIE, SESSION_COOKIE };

const SECURE = (process.env.APP_BASE_URL ?? "http://localhost:3000").startsWith("https");
const MAX_AGE = 60 * 60 * 12; // 12h

export interface Session {
  sub: string;
  name?: string;
  email?: string;
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  /** epoch seconds when the access token expires */
  expiresAt: number;
}

function key(): Uint8Array {
  const secret = process.env.SESSION_SECRET ?? "dev-session-secret-change-me";
  return new Uint8Array(createHash("sha256").update(secret).digest());
}

export async function sealSession(s: Session): Promise<string> {
  return new EncryptJWT({ ...s })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .encrypt(key());
}

export async function openSession(token: string): Promise<Session | null> {
  try {
    const { payload } = await jwtDecrypt(token, key());
    return payload as unknown as Session;
  } catch {
    return null;
  }
}

export function sessionFromTokens(claims: { sub: string; name?: string; email?: string }, t: TokenSet): Session {
  return {
    sub: claims.sub,
    name: claims.name,
    email: claims.email,
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    idToken: t.id_token,
    expiresAt: Math.floor(Date.now() / 1000) + (t.expires_in ?? 300),
  };
}

const cookieOpts = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: SECURE,
  path: "/",
};

export async function setSessionCookie(res: NextResponse, s: Session): Promise<void> {
  res.cookies.set(SESSION_COOKIE, await sealSession(s), { ...cookieOpts, maxAge: MAX_AGE });
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set(SESSION_COOKIE, "", { ...cookieOpts, maxAge: 0 });
}

export function setPkceCookie(res: NextResponse, value: string): void {
  // short-lived, holds {state, verifier} JSON for the round-trip to Keycloak
  res.cookies.set(PKCE_COOKIE, value, { ...cookieOpts, maxAge: 600 });
}

export function clearPkceCookie(res: NextResponse): void {
  res.cookies.set(PKCE_COOKIE, "", { ...cookieOpts, maxAge: 0 });
}

/** Read + decrypt the session from a request (no refresh). */
export async function readSession(req: NextRequest): Promise<Session | null> {
  const raw = req.cookies.get(SESSION_COOKIE)?.value;
  return raw ? openSession(raw) : null;
}

/**
 * Read the session and, if the access token is within 30s of expiry, refresh it
 * against Keycloak. Returns the (possibly refreshed) session and whether it
 * changed (so the caller can re-seal the cookie on its response).
 */
export async function readValidSession(
  req: NextRequest,
): Promise<{ session: Session | null; refreshed: boolean }> {
  const session = await readSession(req);
  if (!session) return { session: null, refreshed: false };

  const now = Math.floor(Date.now() / 1000);
  if (session.expiresAt - now > 30 || !session.refreshToken) {
    return { session, refreshed: false };
  }
  try {
    const t = await refreshTokens(session.refreshToken);
    const next: Session = {
      ...session,
      accessToken: t.access_token,
      refreshToken: t.refresh_token ?? session.refreshToken,
      idToken: t.id_token ?? session.idToken,
      expiresAt: now + (t.expires_in ?? 300),
    };
    return { session: next, refreshed: true };
  } catch {
    // refresh failed → treat as expired; caller should 401 / re-login.
    return { session: null, refreshed: false };
  }
}
