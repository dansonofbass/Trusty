import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Cancel a booked session — either side. */
export function POST(req: NextRequest, ctx: { params: Promise<{ id: string; slotId: string }> }) {
  return ctx.params.then(({ id, slotId }) =>
    proxyGraph(req, `/api/specialists/${encodeURIComponent(id)}/slots/${encodeURIComponent(slotId)}/cancel`, "POST", {
      sendAdminFlag: true,
    }),
  );
}
