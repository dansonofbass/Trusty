import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Trust-ranked cards for an explicit id list ({ids: string[]}) — a circle's
 *  admin-pinned mentors. */
export function POST(req: NextRequest) {
  return proxyGraph(req, "/api/specialists/cards", "POST");
}
