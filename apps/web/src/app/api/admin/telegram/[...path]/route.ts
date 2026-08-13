import { NextResponse, type NextRequest } from "next/server";
import { readValidSession, setSessionCookie } from "@/lib/auth/session";
import { isAdmin } from "@/lib/auth/roles";

const GRAPH = process.env.GRAPH_INTERNAL_URL ?? "http://graph-service:4001";
const CONNECTOR = process.env.TELEGRAM_CONNECTOR_URL ?? "http://connector-telegram:4008";

/**
 * Admin-only BFF for the Telegram connector.
 *
 * Everything under /api/admin/telegram/* forwards to graph-service, except the
 * two verbs that make the connector do work (`ingest`, `run`) which go to the
 * connector itself. Neither service is browser-reachable; the Keycloak admin
 * check happens here, once.
 */
async function gated(req: NextRequest, path: string[], method: string) {
  const { session, refreshed } = await readValidSession(req);
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!(await isAdmin(session))) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const head = path[0] ?? "";
  const toConnector = head === "ingest" || head === "run";
  const base = toConnector ? CONNECTOR : GRAPH;
  const suffix = toConnector ? path.join("/") : `api/admin/telegram/${path.join("/")}`;
  const url = new URL(`${base.replace(/\/+$/, "")}/${suffix}`);
  req.nextUrl.searchParams.forEach((v, k) => url.searchParams.set(k, v));

  const body = method === "GET" || method === "DELETE" ? undefined : await req.text();

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method,
      headers: {
        "content-type": "application/json",
        "x-user-id": session.sub,
        "x-user-admin": "1",
        ...(process.env.CONNECTOR_ADMIN_SECRET
          ? { "x-admin-secret": process.env.CONNECTOR_ADMIN_SECRET }
          : {}),
      },
      body,
      // A 15 MB export takes real time to parse, classify and extract.
      signal: AbortSignal.timeout(toConnector ? 300_000 : 30_000),
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : "upstream unreachable";
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

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  return gated(req, (await ctx.params).path ?? [], "GET");
}
export async function POST(req: NextRequest, ctx: Ctx) {
  return gated(req, (await ctx.params).path ?? [], "POST");
}
export async function DELETE(req: NextRequest, ctx: Ctx) {
  return gated(req, (await ctx.params).path ?? [], "DELETE");
}
