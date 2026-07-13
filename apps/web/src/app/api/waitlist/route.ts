import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Waitlist progress for the viewer. */
export function GET(req: NextRequest) {
  return proxyGraph(req, "/api/waitlist/status", "GET");
}

/** Join the waitlist: mint a referral link + record the entry. */
export function POST(req: NextRequest) {
  return proxyGraph(req, "/api/waitlist/join", "POST");
}
