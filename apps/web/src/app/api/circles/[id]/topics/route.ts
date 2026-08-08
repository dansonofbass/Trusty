import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Forum sections in a circle. */
export function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return ctx.params.then(({ id }) => proxyGraph(req, `/api/circles/${encodeURIComponent(id)}/topics`, "GET"));
}

/** Create a topic — moderators/owners/admins (graph-service enforces). */
export function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return ctx.params.then(({ id }) =>
    proxyGraph(req, `/api/circles/${encodeURIComponent(id)}/topics`, "POST", { sendAdminFlag: true }),
  );
}
