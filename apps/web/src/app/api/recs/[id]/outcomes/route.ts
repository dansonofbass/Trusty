import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Attach an outcome (👍/👎) to a recommendation — evidence accumulation that
 *  feeds the target's reputation and the author's contribution. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return proxyGraph(req, `/api/recs/${encodeURIComponent(id)}/outcomes`, "POST");
}
