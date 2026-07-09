import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Pending "did it work out?" prompts for the viewer. */
export function GET(req: NextRequest) {
  return proxyGraph(req, "/api/outcomes/pending", "GET");
}
