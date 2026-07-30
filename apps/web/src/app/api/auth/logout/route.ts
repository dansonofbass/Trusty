import { NextResponse, type NextRequest } from "next/server";
import { buildLogoutUrl } from "@/lib/auth/keycloak";
import { clearSessionCookie, readSession } from "@/lib/auth/session";
import { emitWebEvent } from "@/lib/domainEvents";

/** Clear the local session and bounce through Keycloak's end-session endpoint. */
export async function GET(req: NextRequest) {
  const session = await readSession(req);
  emitWebEvent("auth.logout", session?.sub);
  const res = NextResponse.redirect(buildLogoutUrl(session?.idToken));
  clearSessionCookie(res);
  return res;
}
