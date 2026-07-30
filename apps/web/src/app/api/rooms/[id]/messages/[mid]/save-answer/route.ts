import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Pin a room message as a saved, attributed answer. */
export function POST(req: NextRequest, ctx: { params: Promise<{ id: string; mid: string }> }) {
  return ctx.params.then(({ id, mid }) =>
    proxyGraph(req, `/api/rooms/${encodeURIComponent(id)}/messages/${encodeURIComponent(mid)}/save-answer`, "POST"),
  );
}
