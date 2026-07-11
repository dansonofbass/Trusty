import { type NextRequest } from "next/server";
import { proxyGraphAdmin } from "@/lib/auth/graphProxy";

/** Admin: update any node's label + properties. */
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return proxyGraphAdmin(req, `/api/admin/entities/${encodeURIComponent(id)}`, "PUT");
}

/** Admin: delete any node + its children + edges. */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return proxyGraphAdmin(req, `/api/admin/entities/${encodeURIComponent(id)}`, "DELETE");
}
