import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Any signed-in user proposes an edit to a place's core fields (moderation queue). */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return proxyGraph(req, `/api/places/${encodeURIComponent(id)}/suggest`, "POST");
}
