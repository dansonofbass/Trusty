import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Circle sidebar: description, moderators, contributors, pinned mentors. */
export function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return ctx.params.then(({ id }) =>
    proxyGraph(req, `/api/circles/${encodeURIComponent(id)}/about`, "GET", { sendAdminFlag: true }),
  );
}
