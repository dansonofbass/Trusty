"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getAccess } from "@/lib/accessClient";

/**
 * Client-side front-door gate. Reads the viewer's account status once per
 * navigation and bounces them to the right place:
 *   waitlisted         → /waitlist
 *   pending_onboarding → /onboarding
 *   active             → stays put (full access)
 *
 * The waitlist/onboarding/invite routes are exempt (they ARE the destinations),
 * and an unauthenticated / open-mode response (null) is a no-op so logged-out
 * invite-landing visitors are never touched. Server routing in the auth callback
 * already lands users correctly; this guard just enforces it on later navigation
 * and direct URL entry.
 */
const EXEMPT = ["/onboarding", "/waitlist", "/invite"];

/**
 * Session-expiry watchdog. The BFF silently refreshes tokens; once refresh
 * fails it answers 401 on every authenticated /api route — and without this,
 * the app just sits there broken (empty panels, dead sends). Patch fetch once:
 * a same-origin 401 from a session-backed API route means the session is dead
 * → bounce to login (Keycloak SSO makes this seamless if only our cookie
 * lapsed). Fires at most once; /api/auth + /api/public stay exempt (they 401
 * legitimately for logged-out visitors), as does the public invite landing.
 */
let sessionWatchInstalled = false;
let redirectingToLogin = false;
function installSessionWatch() {
  if (sessionWatchInstalled || typeof window === "undefined") return;
  sessionWatchInstalled = true;
  const orig = window.fetch.bind(window);
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const res = await orig(...args);
    try {
      if (res.status === 401 && !redirectingToLogin) {
        const input = args[0];
        const raw =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const u = new URL(raw, window.location.origin);
        const authedApi =
          u.origin === window.location.origin &&
          u.pathname.startsWith("/api/") &&
          !u.pathname.startsWith("/api/auth/") &&
          !u.pathname.startsWith("/api/public/");
        const onPublicPage = window.location.pathname.startsWith("/invite");
        if (authedApi && !onPublicPage) {
          redirectingToLogin = true;
          window.location.assign("/api/auth/login");
        }
      }
    } catch {
      // never let the watchdog break a caller's response handling
    }
    return res;
  };
}

export default function AccessGuard() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    installSessionWatch();
  }, []);

  useEffect(() => {
    if (EXEMPT.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return;
    let cancelled = false;
    getAccess().then((access) => {
      if (cancelled || !access) return;
      if (access.status === "waitlisted") router.replace("/waitlist");
      else if (access.status === "pending_onboarding" && !access.onboardingComplete)
        router.replace("/onboarding");
    });
    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  return null;
}
