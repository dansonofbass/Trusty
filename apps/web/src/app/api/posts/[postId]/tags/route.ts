import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Re-tag a question — its author, a moderator, or an admin. */
export function PATCH(req: NextRequest, ctx: { params: Promise<{ postId: string }> }) {
  return ctx.params.then(({ postId }) =>
    proxyGraph(req, `/api/posts/${encodeURIComponent(postId)}/tags`, "PATCH", { sendAdminFlag: true }),
  );
}
