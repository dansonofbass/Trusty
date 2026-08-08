import { type NextRequest } from "next/server";
import { proxyGraphAdmin } from "@/lib/auth/graphProxy";

/** Admin: unpin a mentor from this circle. */
export function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string; specialistId: string }> }) {
  return ctx.params.then(({ id, specialistId }) =>
    proxyGraphAdmin(
      req,
      `/api/admin/circles/${encodeURIComponent(id)}/mentors/${encodeURIComponent(specialistId)}`,
      "DELETE",
    ),
  );
}
