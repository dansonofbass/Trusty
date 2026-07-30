import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Your notifications (follows, squad joins, confirmations, trust, meetings). */
export function GET(req: NextRequest) {
  return proxyGraph(req, `/api/notifications`, "GET");
}
