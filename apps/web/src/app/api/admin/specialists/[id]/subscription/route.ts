import { type NextRequest } from "next/server";
import { proxyGraphAdmin } from "@/lib/auth/graphProxy";

/** Admin: grant/change a specialist subscription ({plan, state, endsAt?}). */
export function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return ctx.params.then(({ id }) =>
    proxyGraphAdmin(req, `/api/admin/specialists/${encodeURIComponent(id)}/subscription`, "POST"),
  );
}
