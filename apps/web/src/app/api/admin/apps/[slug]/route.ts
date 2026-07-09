import { type NextRequest } from "next/server";
import { proxyGraphAdmin } from "@/lib/auth/graphProxy";

/** Admin: delete an app (cascades its entity types + relations). */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  return proxyGraphAdmin(req, `/api/admin/apps/${encodeURIComponent(slug)}`, "DELETE");
}
