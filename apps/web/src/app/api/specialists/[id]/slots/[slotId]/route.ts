import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Withdraw an unbooked slot. */
export function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string; slotId: string }> }) {
  return ctx.params.then(({ id, slotId }) =>
    proxyGraph(
      req,
      `/api/specialists/${encodeURIComponent(id)}/slots/${encodeURIComponent(slotId)}`,
      "DELETE",
      { sendAdminFlag: true },
    ),
  );
}
