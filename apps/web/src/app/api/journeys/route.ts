import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** The viewer's decision journeys (#35) — ?status=active|open|decided|completed|closed. */
export function GET(req: NextRequest) {
  return proxyGraph(req, `/api/journeys${req.nextUrl.search}`, "GET");
}

/** Manually start a journey (they normally begin automatically via the agent). */
export function POST(req: NextRequest) {
  return proxyGraph(req, `/api/journeys`, "POST");
}
