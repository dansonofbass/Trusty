import { type NextRequest } from "next/server";
import { proxyGraphAdmin } from "@/lib/auth/graphProxy";

/** Admin: remove a photo from a place's gallery (moderation). */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return proxyGraphAdmin(req, `/api/places/${encodeURIComponent(id)}/photos`, "DELETE");
}
