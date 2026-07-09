import { type NextRequest } from "next/server";
import { proxyGraphAdmin } from "@/lib/auth/graphProxy";

/** Admin: approve a suggestion (applies the patch to the place). */
export async function POST(req: NextRequest, ctx: { params: Promise<{ sid: string }> }) {
  const { sid } = await ctx.params;
  return proxyGraphAdmin(req, `/api/admin/place-suggestions/${encodeURIComponent(sid)}/approve`, "POST");
}
