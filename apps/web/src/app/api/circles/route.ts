import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Circles in the current space (browse) / create a circle. */
export function GET(req: NextRequest) {
  return proxyGraph(req, `/api/circles`, "GET");
}

export function POST(req: NextRequest) {
  return proxyGraph(req, `/api/circles`, "POST");
}
