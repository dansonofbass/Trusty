import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Add a dish to a place's menu (menu_item node PART_OF the restaurant/cafe). */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return proxyGraph(req, `/api/places/${encodeURIComponent(id)}/menu`, "POST");
}
