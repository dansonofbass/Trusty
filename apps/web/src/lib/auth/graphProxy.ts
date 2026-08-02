import { NextResponse, type NextRequest } from "next/server";
import { readValidSession, setSessionCookie } from "./session";
import { isAdmin } from "./roles";
import { spaceFromHost } from "@/lib/space";

const GRAPH = process.env.GRAPH_SERVICE_INTERNAL_URL ?? "http://graph-service:4001";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

async function forward(
  req: NextRequest,
  session: NonNullable<Awaited<ReturnType<typeof readValidSession>>["session"]>,
  refreshed: boolean,
  path: string,
  method: Method,
  extraHeaders?: Record<string, string>,
): Promise<NextResponse> {
  // Space scoping: the subdomain the user is on decides the app scope for
  // every proxied read/mutation (explicit ?app= in a path still wins inside
  // graph-service). Client-sent x-app is the fallback for the neutral home.
  const space = spaceFromHost(req.headers.get("host") ?? undefined) ?? req.headers.get("x-app") ?? undefined;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-user-id": session.sub,
    ...(space ? { "x-app": space } : {}),
    ...(session.name ? { "x-user-name": encodeURIComponent(session.name) } : {}),
    ...(session.email ? { "x-user-email": encodeURIComponent(session.email) } : {}),
    ...extraHeaders,
  };
  const body = method === "GET" ? undefined : await req.text();

  let upstream: Response;
  try {
    upstream = await fetch(`${GRAPH}${path}`, { method, headers, body, cache: "no-store" });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "graph-service unreachable" }, { status: 502 });
  }

  const text = await upstream.text();
  const res = new NextResponse(text, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
  if (refreshed) await setSessionCookie(res, session);
  return res;
}

/**
 * Authenticated BFF proxy to a graph-service REST endpoint. Verifies the session,
 * forwards the user identity headers graph-service expects, and re-seals the
 * cookie on token refresh.
 */
export async function proxyGraph(
  req: NextRequest,
  path: string,
  method: Method,
  opts?: {
    /** Forward a verified `x-user-admin: 1` header when the session holds the
     * admin role — lets graph-service apply admin-only behaviour (e.g. the
     * front-door gate exempts admins). Role verification happens HERE (JWT
     * signature via isAdmin); graph-service trusts BFF headers by design. */
    sendAdminFlag?: boolean;
  },
): Promise<NextResponse> {
  const { session, refreshed } = await readValidSession(req);
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const extra = opts?.sendAdminFlag && (await isAdmin(session)) ? { "x-user-admin": "1" } : undefined;
  return forward(req, session, refreshed, path, method, extra);
}

/**
 * Admin-only proxy: same as {@link proxyGraph} but requires the session to pass
 * `isAdmin`. graph-service has no role checks, so admin-intent endpoints MUST be
 * reached only through this gate.
 */
export async function proxyGraphAdmin(req: NextRequest, path: string, method: Method): Promise<NextResponse> {
  const { session, refreshed } = await readValidSession(req);
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!(await isAdmin(session))) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  // The role is verified HERE (JWT signature). graph-service trusts BFF headers
  // by design, and several admin routes re-check `x-user-admin` — without this
  // header they 403 the very requests this gate just authorized.
  return forward(req, session, refreshed, path, method, { "x-user-admin": "1" });
}
