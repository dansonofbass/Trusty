import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Create a workspace folder ({name, parentId?}) — agentic-ux P3. */
export function POST(req: NextRequest) {
  return proxyGraph(req, `/api/writings/folders`, "POST");
}
