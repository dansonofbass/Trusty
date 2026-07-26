import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Replace a conversation's display turns + raw agent transcript. */
export function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return ctx.params.then(({ id }) => proxyGraph(req, `/api/conversations/${encodeURIComponent(id)}/turns`, "PUT"));
}
