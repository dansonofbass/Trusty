import { type NextRequest } from "next/server";
import { proxyGraphAdmin } from "@/lib/auth/graphProxy";

/** Admin: all session times for a specialist, including booked ones. */
export function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return ctx.params.then(({ id }) =>
    proxyGraphAdmin(req, `/api/admin/specialists/${encodeURIComponent(id)}/slots`, "GET"),
  );
}

/** Admin: publish a session time on the specialist's behalf. */
export function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return ctx.params.then(({ id }) =>
    proxyGraphAdmin(req, `/api/admin/specialists/${encodeURIComponent(id)}/slots`, "POST"),
  );
}
