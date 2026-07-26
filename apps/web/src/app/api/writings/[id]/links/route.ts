import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Outgoing wikilinks + incoming backlinks for a doc (agentic-ux P4). */
export function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return ctx.params.then(({ id }) => proxyGraph(req, `/api/writings/${encodeURIComponent(id)}/links`, "GET"));
}
