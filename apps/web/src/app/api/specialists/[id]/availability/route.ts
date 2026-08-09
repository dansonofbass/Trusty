import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Replace the weekly availability pattern; slots regenerate from it. */
export function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return ctx.params.then(({ id }) =>
    proxyGraph(req, `/api/specialists/${encodeURIComponent(id)}/availability`, "PUT", { sendAdminFlag: true }),
  );
}
