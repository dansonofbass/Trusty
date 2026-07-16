import { type NextRequest } from "next/server";
import { proxyGraphAdmin } from "@/lib/auth/graphProxy";

/** Admin: approve a waitlisted user — grants onboarding access. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ userId: string }> }) {
  const { userId } = await ctx.params;
  return proxyGraphAdmin(req, `/api/admin/waitlist/${encodeURIComponent(userId)}/approve`, "POST");
}
