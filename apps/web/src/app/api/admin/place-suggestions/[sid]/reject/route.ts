import { type NextRequest } from "next/server";
import { proxyGraphAdmin } from "@/lib/auth/graphProxy";

/** Admin: reject a suggestion. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ sid: string }> }) {
  const { sid } = await ctx.params;
  return proxyGraphAdmin(req, `/api/admin/place-suggestions/${encodeURIComponent(sid)}/reject`, "POST");
}
