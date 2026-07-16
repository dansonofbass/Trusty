import { type NextRequest } from "next/server";
import { proxyGraphAdmin } from "@/lib/auth/graphProxy";

/** Admin: grant credits to a user (auditable). */
export async function POST(req: NextRequest, ctx: { params: Promise<{ userId: string }> }) {
  const { userId } = await ctx.params;
  return proxyGraphAdmin(req, `/api/admin/credits/${encodeURIComponent(userId)}`, "POST");
}
