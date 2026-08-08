import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Mark an answer as the one that solved it — the asker or a moderator. */
export function POST(req: NextRequest, ctx: { params: Promise<{ answerId: string }> }) {
  return ctx.params.then(({ answerId }) =>
    proxyGraph(req, `/api/answers/${encodeURIComponent(answerId)}/accept`, "POST", { sendAdminFlag: true }),
  );
}
