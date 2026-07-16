import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Recommendations from the people I listen to (evidence-ranked, never trust). */
export function GET(req: NextRequest) {
  return proxyGraph(req, `/api/listen/feed${req.nextUrl.search}`, "GET");
}
