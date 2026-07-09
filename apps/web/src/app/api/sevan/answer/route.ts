import { NextResponse, type NextRequest } from "next/server";
import { readValidSession } from "@/lib/auth/session";

const EXTRACTOR = process.env.EXTRACTOR_INTERNAL_URL ?? "http://extractor:4003";

/** Streamed agent-style answer over directory search results (SSE pipe). */
export async function POST(req: NextRequest) {
  const { session } = await readValidSession(req);
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const body = await req.text();
  let upstream: Response;
  try {
    upstream = await fetch(`${EXTRACTOR}/sevan-answer/stream`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-id": session.sub },
      body,
      cache: "no-store",
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "extractor unreachable" }, { status: 502 });
  }
  if (!upstream.ok || !upstream.body) {
    const t = await upstream.text().catch(() => "");
    return NextResponse.json({ error: t || `extractor ${upstream.status}` }, { status: upstream.status || 502 });
  }
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "text/event-stream",
      "cache-control": "no-cache, no-transform",
    },
  });
}
