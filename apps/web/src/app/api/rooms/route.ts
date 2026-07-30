import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** My messaging rooms (squad chat now; community groups later). */
export function GET(req: NextRequest) {
  return proxyGraph(req, `/api/rooms`, "GET");
}
