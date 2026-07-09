import { NextResponse, type NextRequest } from "next/server";
import { readValidSession, setSessionCookie } from "@/lib/auth/session";

const GATEWAY = process.env.GATEWAY_INTERNAL_URL ?? "http://gateway:4000/graphql";

/**
 * BFF proxy: forwards the browser's GraphQL request to the internal gateway,
 * injecting the authenticated user's id (and access token). The browser never
 * sees the gateway or the token directly.
 */
export async function POST(req: NextRequest) {
  const { session, refreshed } = await readValidSession(req);
  if (!session) {
    return NextResponse.json({ errors: [{ message: "unauthenticated" }] }, { status: 401 });
  }

  const body = await req.text();
  let upstream: Response;
  try {
    upstream = await fetch(GATEWAY, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-user-id": session.sub,
        ...(session.name ? { "x-user-name": encodeURIComponent(session.name) } : {}),
        ...(session.email ? { "x-user-email": encodeURIComponent(session.email) } : {}),
        authorization: `Bearer ${session.accessToken}`,
      },
      body,
      cache: "no-store",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "gateway unreachable";
    return NextResponse.json({ errors: [{ message }] }, { status: 502 });
  }

  const text = await upstream.text();
  const res = new NextResponse(text, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
  if (refreshed) await setSessionCookie(res, session);
  return res;
}
