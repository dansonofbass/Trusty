import { type NextRequest } from "next/server";
import { proxyGraphAdmin } from "@/lib/auth/graphProxy";

/** Admin: remove a meeting venue. */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return proxyGraphAdmin(req, `/api/admin/locations/${encodeURIComponent(id)}`, "DELETE");
}
