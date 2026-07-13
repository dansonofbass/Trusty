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

export default function AccessGuard() {
  const router = useRouter();
  const pathname = usePathname();

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
