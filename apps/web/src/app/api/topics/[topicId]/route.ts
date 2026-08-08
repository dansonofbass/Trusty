import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Rename/reorder a topic — moderators/admins (graph-service enforces). */
export function PATCH(req: NextRequest, ctx: { params: Promise<{ topicId: string }> }) {
  return ctx.params.then(({ topicId }) =>
    proxyGraph(req, `/api/topics/${encodeURIComponent(topicId)}`, "PATCH", { sendAdminFlag: true }),
  );
}

/** Delete a topic. Posts survive and fall back to the circle root. */
export function DELETE(req: NextRequest, ctx: { params: Promise<{ topicId: string }> }) {
  return ctx.params.then(({ topicId }) =>
    proxyGraph(req, `/api/topics/${encodeURIComponent(topicId)}`, "DELETE", { sendAdminFlag: true }),
  );
}
