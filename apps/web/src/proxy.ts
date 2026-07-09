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
    return NextResponse.redirect(new URL("/api/auth/login", req.url));
  }
  return NextResponse.next();
}

export const config = {
  // Match everything except API routes, Next internals, and files with an
  // extension (static assets). Page routes like "/" are gated. `/invite/*` is
  // excluded so a logged-out visitor can view an invite landing page (its CTA
  // then sends them into the auth flow).
  matcher: ["/((?!api|invite|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
