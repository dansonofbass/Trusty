import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Answer an ask by naming a provider (creates a trust edge for the responder). */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return proxyGraph(req, `/api/asks/${encodeURIComponent(id)}/answer${req.nextUrl.search}`, "POST");
}
