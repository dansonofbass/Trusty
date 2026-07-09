import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Browse the shared places catalog by topic (+ optional near-me distance). */
export function GET(req: NextRequest) {
  return proxyGraph(req, `/api/places${req.nextUrl.search}`, "GET");
}
