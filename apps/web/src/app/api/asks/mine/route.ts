import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** The viewer's asks + answers received. */
export function GET(req: NextRequest) {
  return proxyGraph(req, `/api/asks/mine${req.nextUrl.search}`, "GET");
}
