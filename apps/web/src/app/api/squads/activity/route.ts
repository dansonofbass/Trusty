import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Cross-squad activity for Discover: chatter volume + recent joins. */
export function GET(req: NextRequest) {
  return proxyGraph(req, `/api/squads/activity`, "GET");
}
