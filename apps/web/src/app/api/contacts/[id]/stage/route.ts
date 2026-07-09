import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Advance a saved contact through the meeting lifecycle (…→ trust). */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return proxyGraph(req, `/api/contacts/${encodeURIComponent(id)}/stage`, "POST");
}
