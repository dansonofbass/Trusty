import { NextResponse, type NextRequest } from "next/server";
import { readValidSession } from "@/lib/auth/session";

const EXTRACTOR = process.env.EXTRACTOR_INTERNAL_URL ?? "http://extractor:4003";

/** NL directory search → structured filters (Trusty Sevan agent search). */
export async function POST(req: NextRequest) {
  const { session } = await readValidSession(req);
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const body = await req.text();
  try {
    const upstream = await fetch(`${EXTRACTOR}/sevan-query`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-id": session.sub },
      body,
      cache: "no-store",
    });
    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "extractor unreachable" }, { status: 502 });
  }
}
