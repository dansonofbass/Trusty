import { type NextRequest } from "next/server";
import { proxyGraphAdmin } from "@/lib/auth/graphProxy";

/** Admin: remove a dish from a place's menu (moderation). */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string; dishId: string }> }) {
  const { id, dishId } = await ctx.params;
  return proxyGraphAdmin(req, `/api/places/${encodeURIComponent(id)}/menu/${encodeURIComponent(dishId)}`, "DELETE");
}
