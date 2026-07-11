import { type NextRequest } from "next/server";
import { proxyGraphAdmin } from "@/lib/auth/graphProxy";

/** Admin: remove a relation edge. */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ edgeId: string }> }) {
  const { edgeId } = await ctx.params;
  return proxyGraphAdmin(req, `/api/admin/relations/${encodeURIComponent(edgeId)}`, "DELETE");
}
