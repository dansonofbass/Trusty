import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Batch-log browser interactions (impressions/clicks of rendered recs). */
export function POST(req: NextRequest) {
  return proxyGraph(req, "/api/interactions", "POST");
}
