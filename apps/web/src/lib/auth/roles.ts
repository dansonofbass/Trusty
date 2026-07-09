import type { Session } from "./session";
import { verifyAccessToken } from "./keycloak";

/**
 * Admin authorization — OIDC-first.
 *
 * Primary mechanism: a Keycloak role (default `admin`) carried in the access
 * token, as a realm role (`realm_access.roles`) or a client role
 * (`resource_access.<client>.roles`). Assign it in the Keycloak admin console
 * (Realm roles → admin → Users in role), or it ships in the realm export for
 * fresh imports.
 *
 * Bootstrap escape hatch: ADMIN_EMAILS — a comma-separated allowlist of OIDC
 * emails. Useful when the Keycloak volume already exists (so the realm export
 * won't re-import) and you want to grant yourself admin without the console.
 */

const ADMIN_ROLE = process.env.ADMIN_ROLE ?? "admin";

function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

interface AccessTokenClaims {
  realm_access?: { roles?: string[] };
  resource_access?: Record<string, { roles?: string[] }>;
}

/**
 * Roles granted to the user by Keycloak (realm + this client's roles).
 *
 * The access token's SIGNATURE is verified against Keycloak's JWKS before any
 * claim is trusted (a forged/expired token yields no roles) — hardening the
 * previous decode-without-verify path. Returns [] on any verification failure.
 */
export async function rolesOf(session: Session): Promise<string[]> {
  const claims = (await verifyAccessToken(session.accessToken)) as unknown as AccessTokenClaims | null;
  if (!claims) return [];
  const clientId = process.env.KEYCLOAK_CLIENT_ID ?? "constellation-web";
  return [
    ...(claims.realm_access?.roles ?? []),
    ...(claims.resource_access?.[clientId]?.roles ?? []),
  ];
}

/** True when the session holds the admin role or an allowlisted email. */
export async function isAdmin(session: Session): Promise<boolean> {
  if (session.email && adminEmails().includes(session.email.toLowerCase())) return true;
  // Role names are case-sensitive in Keycloak; compare loosely so "Admin" works too.
  const want = ADMIN_ROLE.toLowerCase();
  return (await rolesOf(session)).some((r) => r.toLowerCase() === want);
}
