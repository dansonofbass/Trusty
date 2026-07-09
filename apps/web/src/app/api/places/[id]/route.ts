import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Full detail for one catalog place (trust layer + logistics + similar). */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return proxyGraph(req, `/api/places/${encodeURIComponent(id)}${req.nextUrl.search}`, "GET");
}
