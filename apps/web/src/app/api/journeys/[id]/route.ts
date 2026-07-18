import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** One journey with its full timeline + per-recommendation states (owner only). */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return proxyGraph(req, `/api/journeys/${encodeURIComponent(id)}`, "GET");
}
