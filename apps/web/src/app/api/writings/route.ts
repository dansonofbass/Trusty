import { NextResponse, type NextRequest } from "next/server";
import { readValidSession } from "@/lib/auth/session";

const GRAPH = process.env.GRAPH_SERVICE_INTERNAL_URL ?? "http://graph-service:4001";

/** BFF proxy: the viewer's writings log (Postgres-backed, via graph-service). */
export async function GET(req: NextRequest) {
  const { session } = await readValidSession(req);
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  try {
    const r = await fetch(`${GRAPH}/api/writings`, {
      headers: { "x-user-id": session.sub },
      cache: "no-store",
    });
    const text = await r.text();
    return new NextResponse(text, {
      status: r.status,
      headers: { "content-type": r.headers.get("content-type") ?? "application/json" },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unreachable" }, { status: 502 });
  }
}
