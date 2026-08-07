import { type NextRequest } from "next/server";
import { proxyGraphAdmin } from "@/lib/auth/graphProxy";

/** Admin: set structured topic tags ({tags: string[]}) — powers topic search
 *  and the market-test survey's "best experts for this need" matches. */
export function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return ctx.params.then(({ id }) =>
    proxyGraphAdmin(req, `/api/admin/specialists/${encodeURIComponent(id)}/topic-tags`, "PATCH"),
  );
}
