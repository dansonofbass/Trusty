import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Answer a question (or reply to an answer via parentId). */
export function POST(req: NextRequest, ctx: { params: Promise<{ postId: string }> }) {
  return ctx.params.then(({ postId }) =>
    proxyGraph(req, `/api/posts/${encodeURIComponent(postId)}/answers`, "POST", { sendAdminFlag: true }),
  );
}
