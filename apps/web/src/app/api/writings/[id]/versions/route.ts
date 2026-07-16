import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Version history of one workspace doc (owner only). */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return proxyGraph(req, `/api/writings/${encodeURIComponent(id)}/versions`, "GET");
}
