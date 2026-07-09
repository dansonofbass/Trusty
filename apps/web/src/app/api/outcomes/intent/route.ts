import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Record intent to use a provider → schedules a follow-up prompt. */
export function POST(req: NextRequest) {
  return proxyGraph(req, "/api/outcomes/intent", "POST");
}
