import { NextResponse, type NextRequest } from "next/server";
import { readValidSession, setSessionCookie } from "@/lib/auth/session";
import { extractionRateLimit, rateLimited } from "@/lib/rateLimit";

const EXTRACTOR = process.env.EXTRACTOR_INTERNAL_URL ?? "http://extractor:4003";
const GRAPH = process.env.GRAPH_SERVICE_INTERNAL_URL ?? "http://graph-service:4001";

/** Best-effort: record the resolved search as a recommendation signal. */
async function logSearch(sub: string, rawQuery: string, resolved: string): Promise<void> {
  try {
    const scope = JSON.parse(resolved) as { topic?: string; geo?: string; context?: string };
    if (!scope?.topic) return;
    await fetch(`${GRAPH}/api/search/log`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-id": sub },
      body: JSON.stringify({ rawQuery, topic: scope.topic, geo: scope.geo, context: scope.context }),
      cache: "no-store",
    });
  } catch {
    /* signal capture is best-effort */
  }
}

/** BFF proxy: resolve a natural-language search query into a trust scope. */
export async function POST(req: NextRequest) {
  const { session, refreshed } = await readValidSession(req);
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const rl = extractionRateLimit(session.sub);
  if (!rl.ok) return rateLimited(rl);

  const body = await req.text();
  let upstream: Response;
  try {
    upstream = await fetch(`${EXTRACTOR}/resolve-scope`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-id": session.sub },
      body,
      cache: "no-store",
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "extractor unreachable" }, { status: 502 });
  }

  const text = await upstream.text();
  if (upstream.ok) {
    let rawQuery = "";
    try {
      rawQuery = String((JSON.parse(body) as { q?: string })?.q ?? "");
    } catch {
      /* ignore */
    }
    await logSearch(session.sub, rawQuery, text);
  }
  const res = new NextResponse(text, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
  if (refreshed) await setSessionCookie(res, session);
  return res;
}
