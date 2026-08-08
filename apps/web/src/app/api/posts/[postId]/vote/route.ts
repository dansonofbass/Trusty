import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Vote on a question ({value: 1 | -1 | 0}); 0 clears an existing vote. */
export function POST(req: NextRequest, ctx: { params: Promise<{ postId: string }> }) {
  return ctx.params.then(({ postId }) =>
    proxyGraph(req, `/api/posts/${encodeURIComponent(postId)}/vote`, "POST"),
  );
}
