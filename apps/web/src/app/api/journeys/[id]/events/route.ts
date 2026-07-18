import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Append a journey event — context refinement, rec state, note, close/reopen. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return proxyGraph(req, `/api/journeys/${encodeURIComponent(id)}/events`, "POST");
}
