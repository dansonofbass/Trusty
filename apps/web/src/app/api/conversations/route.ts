import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Persistent agent conversations (agentic-ux Phase 2). */
export function GET(req: NextRequest) {
  return proxyGraph(req, `/api/conversations`, "GET");
}

export function POST(req: NextRequest) {
  return proxyGraph(req, `/api/conversations`, "POST");
}
