import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Specialist profile view (#39): lifecycle + layered fields + derived evidence.
 *  sendAdminFlag lets admins see the manager list without being managers. */
export function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return ctx.params.then(({ id }) =>
    proxyGraph(req, `/api/specialists/${encodeURIComponent(id)}`, "GET", { sendAdminFlag: true }),
  );
}

/** Provider-controlled profile edits — managers, or admins (e.g. seeding a
 *  freshly created, still-unclaimed specialist). sendAdminFlag is required
 *  here too, or graph-service never sees the admin override. */
export function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return ctx.params.then(({ id }) =>
    proxyGraph(req, `/api/specialists/${encodeURIComponent(id)}/profile`, "PATCH", { sendAdminFlag: true }),
  );
}
