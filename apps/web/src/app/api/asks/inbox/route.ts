import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Open asks from your friends that you can answer. */
export function GET(req: NextRequest) {
  return proxyGraph(req, "/api/asks/inbox", "GET");
}
