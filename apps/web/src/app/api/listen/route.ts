import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** My listening state: who I listen to, my audience, slots and capacity breakdown. */
export function GET(req: NextRequest) {
  return proxyGraph(req, "/api/listen", "GET");
}
