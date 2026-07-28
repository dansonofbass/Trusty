import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Summit squads: list (1–16, member counts, mine). */
export function GET(req: NextRequest) {
  return proxyGraph(req, `/api/squads`, "GET");
}
