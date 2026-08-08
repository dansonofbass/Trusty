import { type NextRequest } from "next/server";
import { proxyGraphAdmin } from "@/lib/auth/graphProxy";

/** Admin: set a circle's topic tags ({tags: string[]}) after creation. */
export function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return ctx.params.then(({ id }) =>
    proxyGraphAdmin(req, `/api/admin/circles/${encodeURIComponent(id)}/topic-tags`, "PATCH"),
  );
}
