import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** First recommendation from the inviter's network (forwards ?topic=). */
export function GET(req: NextRequest) {
  return proxyGraph(req, `/api/onboarding/first-rec${req.nextUrl.search}`, "GET");
}
