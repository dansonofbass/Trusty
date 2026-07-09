import { type NextRequest } from "next/server";
import { proxyGraphAdmin } from "@/lib/auth/graphProxy";

/** Admin: delete an entity type from an app. */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await ctx.params;
  return proxyGraphAdmin(
    req,
    `/api/admin/apps/${encodeURIComponent(slug)}/entity-types/${encodeURIComponent(id)}`,
    "DELETE",
  );
}
