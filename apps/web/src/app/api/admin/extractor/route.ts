import { NextResponse, type NextRequest } from "next/server";
import { readValidSession, setSessionCookie } from "@/lib/auth/session";
import { isAdmin } from "@/lib/auth/roles";

const EXTRACTOR = process.env.EXTRACTOR_INTERNAL_URL ?? "http://extractor:4003";
const ADMIN_SECRET = process.env.EXTRACTOR_ADMIN_SECRET;

/**
 * Admin-only BFF proxy for the extractor's routing config. Enforces the Keycloak
 * admin role here, then forwards to the internal extractor (with the shared admin
 * secret, when configured) — the extractor itself is never browser-reachable.
 */
async function gated(
  req: NextRequest,
  forward: (headers: Record<string, string>) => Promise<Response>,
) {
  const { session, refreshed } = await readValidSession(req);
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!(await isAdmin(session))) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-user-id": session.sub,
    ...(ADMIN_SECRET ? { "x-admin-secret": ADMIN_SECRET } : {}),
  };

  let upstream: Response;
  try {
    upstream = await forward(headers);
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

export async function GET(req: NextRequest) {
  return gated(req, (headers) =>
    fetch(`${EXTRACTOR}/admin/routing`, { method: "GET", headers, cache: "no-store" }),
  );
}

export async function PUT(req: NextRequest) {
  const body = await req.text();
  return gated(req, (headers) =>
    fetch(`${EXTRACTOR}/admin/routing`, { method: "PUT", headers, body, cache: "no-store" }),
  );
}
