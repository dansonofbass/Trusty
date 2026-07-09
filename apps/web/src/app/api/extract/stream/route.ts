import { NextResponse, type NextRequest } from "next/server";
import { readValidSession } from "@/lib/auth/session";
import { extractionRateLimit, rateLimited } from "@/lib/rateLimit";

const EXTRACTOR = process.env.EXTRACTOR_INTERNAL_URL ?? "http://extractor:4003";

/** BFF proxy for the streaming (SSE) extraction used by the Write view. */
export async function POST(req: NextRequest) {
  const { session } = await readValidSession(req);
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const rl = extractionRateLimit(session.sub);
  if (!rl.ok) return rateLimited(rl);

  const body = await req.text();
  let upstream: Response;
  try {
    upstream = await fetch(`${EXTRACTOR}/extract/stream`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-id": session.sub },
      body,
      cache: "no-store",
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : "extractor unreachable";
    return NextResponse.json({ error }, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    const t = await upstream.text().catch(() => "");
    return NextResponse.json({ error: t || `extractor ${upstream.status}` }, {
      status: upstream.status || 502,
    });
  }

  // Stream the SSE body straight through to the browser.
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "text/event-stream",
      "cache-control": "no-cache, no-transform",
    },
  });
}
