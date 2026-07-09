import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** The viewer's invite links + conversion funnel. */
export function GET(req: NextRequest) {
  return proxyGraph(req, "/api/invites", "GET");
}

/** Mint a new invite link. */
export function POST(req: NextRequest) {
  return proxyGraph(req, "/api/invites", "POST");
}
