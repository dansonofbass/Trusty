import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** The viewer's private workspace (#31) — searchable list + collections. */
export function GET(req: NextRequest) {
  return proxyGraph(req, `/api/writings${req.nextUrl.search}`, "GET");
}
