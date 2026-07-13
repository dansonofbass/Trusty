import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** The viewer's front-door state: account status + config + referral progress. */
export function GET(req: NextRequest) {
  return proxyGraph(req, "/api/access", "GET");
}
