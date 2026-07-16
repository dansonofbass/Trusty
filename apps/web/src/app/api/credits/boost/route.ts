import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Spend credits on a temporary Listen-capacity boost. */
export function POST(req: NextRequest) {
  return proxyGraph(req, "/api/credits/boost", "POST");
}
