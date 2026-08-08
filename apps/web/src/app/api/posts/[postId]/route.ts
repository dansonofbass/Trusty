import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** A thread: question + answers + author badges + the viewer's mod rights. */
export function GET(req: NextRequest, ctx: { params: Promise<{ postId: string }> }) {
  return ctx.params.then(({ postId }) =>
    proxyGraph(req, `/api/posts/${encodeURIComponent(postId)}`, "GET", { sendAdminFlag: true }),
  );
}

/** Pin / lock / remove — moderators and admins. */
export function PATCH(req: NextRequest, ctx: { params: Promise<{ postId: string }> }) {
  return ctx.params.then(({ postId }) =>
    proxyGraph(req, `/api/posts/${encodeURIComponent(postId)}`, "PATCH", { sendAdminFlag: true }),
  );
}
