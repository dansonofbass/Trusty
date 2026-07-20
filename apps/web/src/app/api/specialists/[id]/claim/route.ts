import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Submit a claim for management authority over a specialist profile (#39). */
export function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return ctx.params.then(({ id }) =>
    proxyGraph(req, `/api/specialists/${encodeURIComponent(id)}/claim`, "POST"),
  );
}
