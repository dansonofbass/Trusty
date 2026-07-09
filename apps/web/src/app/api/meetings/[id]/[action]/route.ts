import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Confirm / decline a meeting request (target only, enforced in graph-service). */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await ctx.params;
  return proxyGraph(req, `/api/meetings/${encodeURIComponent(id)}/${encodeURIComponent(action)}`, "POST");
}
