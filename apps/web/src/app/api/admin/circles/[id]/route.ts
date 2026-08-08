import { type NextRequest } from "next/server";
import { proxyGraphAdmin } from "@/lib/auth/graphProxy";

/** Admin: edit a circle's own settings. */
export function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return ctx.params.then(({ id }) => proxyGraphAdmin(req, `/api/admin/circles/${encodeURIComponent(id)}`, "PATCH"));
}
