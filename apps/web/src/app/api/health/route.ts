import { NextResponse } from "next/server";

/** Liveness probe for the container healthcheck. Auth-free by design and
 *  redirect-free — the old check probed "/" and followed the login redirect
 *  to Keycloak's public (LAN) hostname, which containers can't hairpin to. */
export function GET() {
  return NextResponse.json({ ok: true });
}
