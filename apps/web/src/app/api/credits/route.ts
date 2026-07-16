import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** My credit balance, sources (earned from contribution + grants), and history. */
export function GET(req: NextRequest) {
  return proxyGraph(req, "/api/credits", "GET");
}
