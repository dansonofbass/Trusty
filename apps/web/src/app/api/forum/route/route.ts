import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Which circle does this question belong in? Ranked candidates with reasons. */
export function POST(req: NextRequest) {
  return proxyGraph(req, "/api/forum/route", "POST", { sendAdminFlag: true });
}
