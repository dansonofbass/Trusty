import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Questions in a circle (?topic=&sort=&limit=), with author badges. */
export function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return ctx.params.then(({ id }) =>
    proxyGraph(req, `/api/circles/${encodeURIComponent(id)}/posts${req.nextUrl.search}`, "GET", { sendAdminFlag: true }),
  );
}

/** Ask a question. */
export function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return ctx.params.then(({ id }) =>
    proxyGraph(req, `/api/circles/${encodeURIComponent(id)}/posts`, "POST", { sendAdminFlag: true }),
  );
}
