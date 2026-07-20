import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Audit timeline — managers and admins only (enforced upstream). */
export function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return ctx.params.then(({ id }) =>
    proxyGraph(req, `/api/specialists/${encodeURIComponent(id)}/timeline`, "GET", { sendAdminFlag: true }),
  );
}
