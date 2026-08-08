import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** The community front door: circles in this space + the merged question feed
 *  across them (?circle=&tag=&sort=&limit=). */
export function GET(req: NextRequest) {
  return proxyGraph(req, `/api/feed${req.nextUrl.search}`, "GET", { sendAdminFlag: true });
}
