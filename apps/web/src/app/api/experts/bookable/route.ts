import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Specialists for a topic, each with their next open session times and price. */
export function GET(req: NextRequest) {
  return proxyGraph(req, `/api/experts/bookable${req.nextUrl.search}`, "GET", { sendAdminFlag: true });
}
