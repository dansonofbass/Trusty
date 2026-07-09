import { type NextRequest } from "next/server";
import { proxyGraphAdmin } from "@/lib/auth/graphProxy";

/** Admin: create/update an entity type in an app. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  return proxyGraphAdmin(req, `/api/admin/apps/${encodeURIComponent(slug)}/entity-types`, "POST");
}
