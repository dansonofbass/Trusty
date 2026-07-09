import { type NextRequest } from "next/server";
import { proxyGraphAdmin } from "@/lib/auth/graphProxy";

/** Admin: edit a place's core fields directly (auto-approved). */
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return proxyGraphAdmin(req, `/api/places/${encodeURIComponent(id)}`, "PUT");
}

/** Admin: delete a place (e.g. a bad link import) + its menu + edges. */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return proxyGraphAdmin(req, `/api/places/${encodeURIComponent(id)}`, "DELETE");
}
