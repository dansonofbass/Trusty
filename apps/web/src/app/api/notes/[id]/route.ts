import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Edit a meeting note (author-only). */
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return proxyGraph(req, `/api/notes/${encodeURIComponent(id)}`, "PUT");
}

/** Delete a meeting note (author-only; its unique edges are rebuilt away). */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return proxyGraph(req, `/api/notes/${encodeURIComponent(id)}`, "DELETE");
}
