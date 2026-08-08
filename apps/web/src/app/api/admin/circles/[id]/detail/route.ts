import { type NextRequest } from "next/server";
import { proxyGraphAdmin } from "@/lib/auth/graphProxy";

/** Admin: full detail for one circle (settings, topics, mods, mentors, activity). */
export function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return ctx.params.then(({ id }) => proxyGraphAdmin(req, `/api/admin/circles/${encodeURIComponent(id)}/detail`, "GET"));
}
