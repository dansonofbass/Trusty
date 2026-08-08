import { type NextRequest } from "next/server";
import { proxyGraphAdmin } from "@/lib/auth/graphProxy";

/** Admin: show/hide a specialist across discovery surfaces ({listed}). */
export function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return ctx.params.then(({ id }) =>
    proxyGraphAdmin(req, `/api/admin/specialists/${encodeURIComponent(id)}/listed`, "PATCH"),
  );
}
