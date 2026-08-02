import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/constants";

/**
 * Next 16 `proxy` (the renamed middleware). Runs on the edge, so it does a cheap
 * presence check only — full session verification happens in the route handlers
 * (Node runtime). Page navigations without a session bounce to login; the
 * `/api/*` routes are excluded by the matcher and enforce auth themselves
 * (returning 401 JSON rather than redirecting).
 */
export function proxy(req: NextRequest) {
  if (!req.cookies.has(SESSION_COOKIE)) {
    const login = new URL("/api/auth/login", req.url);
    // Deep links survive auth: a camera-scanned QR (/?connect=<id>) or a
    // register share link comes back to exactly where it pointed.
    const { pathname, searchParams } = req.nextUrl;
    for (const k of ["register", "invite", "waitlist"] as const) {
      const v = searchParams.get(k);
      if (v) login.searchParams.set(k, v);
    }
    const rest = new URLSearchParams(searchParams);
    rest.delete("register");
    const next = `${pathname}${rest.size ? `?${rest.toString()}` : ""}`;
    if (next !== "/") login.searchParams.set("next", next.slice(0, 400));
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  // Match everything except API routes, Next internals, and files with an
  // extension (static assets). Page routes like "/" are gated. `/invite/*` and
  // `/a/*` (shared answer pages) are excluded so logged-out visitors — and
  // Telegram's link-preview fetcher — can read them; their CTAs then send
  // people into the auth flow.
  matcher: ["/((?!api|invite|a/|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
