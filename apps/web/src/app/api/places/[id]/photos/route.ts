import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Submit a photo URL for a place → moderation queue (admin approves).
 *  Removal is admin-only (see /api/admin/places/[id]/photos). */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return proxyGraph(req, `/api/places/${encodeURIComponent(id)}/photos`, "POST");
}
