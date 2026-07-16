import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Requests awaiting my decision + the ones I've sent. */
export function GET(req: NextRequest) {
  return proxyGraph(req, "/api/listen/requests", "GET");
}

/** Ask to listen to someone (auto-accepted if their policy allows). */
export function POST(req: NextRequest) {
  return proxyGraph(req, "/api/listen/requests", "POST");
}
