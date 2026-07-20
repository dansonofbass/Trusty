import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Subscription status for a specialist profile — managers only (upstream). */
export function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return ctx.params.then(({ id }) =>
    proxyGraph(req, `/api/specialists/${encodeURIComponent(id)}/subscription`, "GET", { sendAdminFlag: true }),
  );
}
