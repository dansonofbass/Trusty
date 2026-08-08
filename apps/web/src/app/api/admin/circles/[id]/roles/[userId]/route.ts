import { type NextRequest } from "next/server";
import { proxyGraphAdmin } from "@/lib/auth/graphProxy";

/** Admin: revoke a circle role. */
export function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string; userId: string }> }) {
  return ctx.params.then(({ id, userId }) =>
    proxyGraphAdmin(req, `/api/admin/circles/${encodeURIComponent(id)}/roles/${encodeURIComponent(userId)}`, "DELETE"),
  );
}
