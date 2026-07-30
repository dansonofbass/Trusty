import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Mark notifications read ({ids?: number[]} — omit for all). */
export function POST(req: NextRequest) {
  return proxyGraph(req, `/api/notifications/read`, "POST");
}
