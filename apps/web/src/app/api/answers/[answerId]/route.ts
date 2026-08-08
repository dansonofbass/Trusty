import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Delete an answer — its author, or an admin. */
export function DELETE(req: NextRequest, ctx: { params: Promise<{ answerId: string }> }) {
  return ctx.params.then(({ answerId }) =>
    proxyGraph(req, `/api/answers/${encodeURIComponent(answerId)}`, "DELETE", { sendAdminFlag: true }),
  );
}
