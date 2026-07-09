import { NextResponse, type NextRequest } from "next/server";
import { readValidSession, setSessionCookie } from "@/lib/auth/session";
import { extractionRateLimit, rateLimited } from "@/lib/rateLimit";

const EXTRACTOR = process.env.EXTRACTOR_INTERNAL_URL ?? "http://extractor:4003";

/**
 * BFF proxy for the Write view: forwards to the extractor's /ingest with the
 * authenticated user as author (server-trusted; the client-supplied authorId is
 * overridden).
 */
export async function POST(req: NextRequest) {
  const { session, refreshed } = await readValidSession(req);
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const rl = extractionRateLimit(session.sub);
  if (!rl.ok) return rateLimited(rl);

  const incoming = await req.json().catch(() => ({}));
  const payload = JSON.stringify({ ...incoming, authorId: session.sub });

  let upstream: Response;
  try {
    upstream = await fetch(`${EXTRACTOR}/ingest`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-user-id": session.sub,
        ...(session.name ? { "x-user-name": encodeURIComponent(session.name) } : {}),
        ...(session.email ? { "x-user-email": encodeURIComponent(session.email) } : {}),
        authorization: `Bearer ${session.accessToken}`,
      },
      body: payload,
      cache: "no-store",
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : "extractor unreachable";
    return NextResponse.json({ error }, { status: 502 });
  }

  const text = await upstream.text();
  const res = new NextResponse(text, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
  if (refreshed) await setSessionCookie(res, session);
  return res;
}
