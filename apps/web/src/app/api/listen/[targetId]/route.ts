import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Stop listening to someone — frees the slot immediately. */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ targetId: string }> }) {
  const { targetId } = await ctx.params;
  return proxyGraph(req, `/api/listen/${encodeURIComponent(targetId)}`, "DELETE");
}
