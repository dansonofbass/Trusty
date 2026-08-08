import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Bookable session times for a specialist. */
export function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return ctx.params.then(({ id }) =>
    proxyGraph(req, `/api/specialists/${encodeURIComponent(id)}/slots`, "GET", { sendAdminFlag: true }),
  );
}

/** Publish availability — managers of a verified specialist. */
export function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return ctx.params.then(({ id }) =>
    proxyGraph(req, `/api/specialists/${encodeURIComponent(id)}/slots`, "POST", { sendAdminFlag: true }),
  );
}
