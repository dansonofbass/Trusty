import { NextResponse, type NextRequest } from "next/server";
import { buildLogoutUrl } from "@/lib/auth/keycloak";
import { clearSessionCookie, readSession } from "@/lib/auth/session";

/** Clear the local session and bounce through Keycloak's end-session endpoint. */
export async function GET(req: NextRequest) {
  const session = await readSession(req);
  const res = NextResponse.redirect(buildLogoutUrl(session?.idToken));
  clearSessionCookie(res);
  return res;
}
