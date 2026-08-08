import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** The viewer's upcoming booked sessions. */
export function GET(req: NextRequest) {
  return proxyGraph(req, "/api/bookings/mine", "GET");
}
