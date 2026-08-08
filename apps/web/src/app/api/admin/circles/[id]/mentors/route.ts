import { type NextRequest } from "next/server";
import { proxyGraphAdmin } from "@/lib/auth/graphProxy";

/** Admin: pin a specialist as a trusted mentor for this circle ({specialistId}). */
export function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return ctx.params.then(({ id }) =>
    proxyGraphAdmin(req, `/api/admin/circles/${encodeURIComponent(id)}/mentors`, "POST"),
  );
}
