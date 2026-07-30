import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

export function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return ctx.params.then(({ id }) => proxyGraph(req, `/api/rooms/${encodeURIComponent(id)}/read`, "POST"));
}
