import { NextResponse, type NextRequest } from "next/server";
import { readValidSession } from "@/lib/auth/session";

const GRAPH = process.env.GRAPH_SERVICE_INTERNAL_URL ?? "http://graph-service:4001";

/** BFF proxy: one writing + its full content and event log. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { session } = await readValidSession(req);
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await ctx.params;
  try {
    const r = await fetch(`${GRAPH}/api/writings/${encodeURIComponent(id)}`, {
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
