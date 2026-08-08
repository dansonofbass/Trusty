import { type NextRequest } from "next/server";
import { proxyGraphAdmin } from "@/lib/auth/graphProxy";

/** Admin: withdraw an unbooked session time. */
export function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string; slotId: string }> }) {
  return ctx.params.then(({ id, slotId }) =>
    proxyGraphAdmin(
      req,
      `/api/admin/specialists/${encodeURIComponent(id)}/slots/${encodeURIComponent(slotId)}`,
      "DELETE",
    ),
  );
}
