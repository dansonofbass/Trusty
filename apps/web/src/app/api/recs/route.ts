import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Publish an immutable recommendation (author = viewer). This is what appears
 * in the feeds of people who LISTEN to you — evidence-ranked, never trust. */
export function POST(req: NextRequest) {
  return proxyGraph(req, "/api/recs", "POST");
}

/** Recommendations for a target (?target=), with outcome consensus. */
export function GET(req: NextRequest) {
  return proxyGraph(req, `/api/recs${req.nextUrl.search}`, "GET");
}
