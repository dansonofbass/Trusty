import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Explainable "who to listen to" suggestions (#23). */
export function GET(req: NextRequest) {
  return proxyGraph(req, `/api/listen/suggestions${req.nextUrl.search}`, "GET");
}
