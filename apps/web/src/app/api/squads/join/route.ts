import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Join a squad ({squadId}) — auto-connects you with squadmates. */
export function POST(req: NextRequest) {
  return proxyGraph(req, `/api/squads/join`, "POST");
}
