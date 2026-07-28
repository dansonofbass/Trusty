import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** My squad + members with peer-confirmation counts. */
export function GET(req: NextRequest) {
  return proxyGraph(req, `/api/squads/mine`, "GET");
}
