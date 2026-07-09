import { type NextRequest } from "next/server";
import { proxyGraphAdmin } from "@/lib/auth/graphProxy";

/** Admin: dismiss a link-history row (doesn't delete the imported place). */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return proxyGraphAdmin(req, `/api/admin/places/links/${encodeURIComponent(id)}`, "DELETE");
}
