import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Set my listen permission policy (manual | auto_accept). */
export function POST(req: NextRequest) {
  return proxyGraph(req, "/api/listen/policy", "POST");
}
