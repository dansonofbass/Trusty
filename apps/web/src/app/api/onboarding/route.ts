import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Resumable onboarding state for the viewer. */
export function GET(req: NextRequest) {
  return proxyGraph(req, "/api/onboarding", "GET");
}

/** Persist one onboarding step (merge). */
export function PATCH(req: NextRequest) {
  return proxyGraph(req, "/api/onboarding", "PATCH");
}
