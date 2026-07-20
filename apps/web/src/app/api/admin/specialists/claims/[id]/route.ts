import { type NextRequest } from "next/server";
import { proxyGraphAdmin } from "@/lib/auth/graphProxy";

/** Admin: approve/reject a specialist claim ({approve: boolean, reason?}). */
export function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return ctx.params.then(({ id }) =>
    proxyGraphAdmin(req, `/api/admin/specialists/claims/${encodeURIComponent(id)}/review`, "POST"),
  );
}
