import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Vote on an answer ({value: 1 | -1 | 0}); 0 clears an existing vote. */
export function POST(req: NextRequest, ctx: { params: Promise<{ answerId: string }> }) {
  return ctx.params.then(({ answerId }) =>
    proxyGraph(req, `/api/answers/${encodeURIComponent(answerId)}/vote`, "POST"),
  );
}
