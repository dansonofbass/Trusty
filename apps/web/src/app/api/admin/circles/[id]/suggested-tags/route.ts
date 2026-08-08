import { type NextRequest } from "next/server";
import { proxyGraphAdmin } from "@/lib/auth/graphProxy";

/** Admin: set the tag vocabulary this circle offers when asking a question. */
export function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return ctx.params.then(({ id }) =>
    proxyGraphAdmin(req, `/api/admin/circles/${encodeURIComponent(id)}/suggested-tags`, "PATCH"),
  );
}
