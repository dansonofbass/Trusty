import { NextResponse, type NextRequest } from "next/server";
import { readValidSession } from "@/lib/auth/session";
import { extractionRateLimit, rateLimited } from "@/lib/rateLimit";
import { spaceFromHost } from "@/lib/space";

const EXTRACTOR = process.env.EXTRACTOR_INTERNAL_URL ?? "http://extractor:4003";

/** The space scope for a proxied call, as a header record (empty when the host
 *  resolves to no space) — a plain `Record<string, string>` so spreading it
 *  into a headers object stays assignable to HeadersInit. */
function spaceHeader(req: NextRequest): Record<string, string> {
  const sp = spaceFromHost(req.headers.get("host") ?? undefined);
  return sp ? { "x-app": sp } : {};
}

/** BFF proxy for the composer agent's streaming (SSE) tool-calling loop (#29). */
export async function POST(req: NextRequest) {
  const { session } = await readValidSession(req);
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const rl = extractionRateLimit(session.sub);
  if (!rl.ok) return rateLimited(rl);

  // Chat credits: charge one AI message BEFORE the turn starts. A 402 carries
  // balance + packs + payment contact, which the client renders as the paywall
  // (no LLM spend on a turn the user can't pay for). Unmetered deployments
  // (no DB) answer ok:true.
  const GRAPH = process.env.GRAPH_SERVICE_INTERNAL_URL ?? "http://graph-service:4001";
  // The consume call also tells us the user's plan tier, which decides WHICH
  // model answers them (admin-configured mapping in the extractor).
  let tier = "free";
  try {
    const quota = await fetch(`${GRAPH}/api/billing/consume`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-user-id": session.sub,
        ...spaceHeader(req),
      },
      body: "{}",
      cache: "no-store",
    });
    if (quota.status === 402) {
      const payload = await quota.json().catch(() => ({}));
      return NextResponse.json(payload, { status: 402 });
    }
    const ok = (await quota.json().catch(() => null)) as { tier?: string } | null;
    if (ok?.tier) tier = ok.tier;
  } catch {
    // Billing unreachable must never block the product — fail open.
  }

  const body = await req.text();
  let upstream: Response;
  try {
    upstream = await fetch(`${EXTRACTOR}/agent/stream`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-user-id": session.sub,
        "x-user-tier": tier,
        ...(session.name ? { "x-user-name": session.name } : {}),
        // Space subdomain → agent tools scope their graph reads to it.
        ...spaceHeader(req),
      },
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

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "text/event-stream",
      "cache-control": "no-cache, no-transform",
    },
  });
}
