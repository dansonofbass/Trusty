import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** One workspace doc + full content and event log (owner only). */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return proxyGraph(req, `/api/writings/${encodeURIComponent(id)}`, "GET");
}

/** Edit a doc — the previous body is preserved as a version server-side. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return proxyGraph(req, `/api/writings/${encodeURIComponent(id)}`, "PATCH");
}

/** Delete a doc (owner only). */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return proxyGraph(req, `/api/writings/${encodeURIComponent(id)}`, "DELETE");
}
