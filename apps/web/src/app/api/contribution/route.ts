import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** The viewer's Contribution Engine summary (score, stage, explanations, timeline).
 * Optional ?topic= scopes the score to one domain. */
export const GET = (req: NextRequest) =>
  proxyGraph(req, `/api/contribution${req.nextUrl.search}`, "GET");
