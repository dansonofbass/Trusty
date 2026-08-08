import { type NextRequest } from "next/server";
import { proxyGraphAdmin } from "@/lib/auth/graphProxy";

/** Admin: who moderates this circle. */
export function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return ctx.params.then(({ id }) => proxyGraphAdmin(req, `/api/admin/circles/${encodeURIComponent(id)}/roles`, "GET"));
}

/** Admin: appoint an owner/moderator ({userId, role}). */
export function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return ctx.params.then(({ id }) => proxyGraphAdmin(req, `/api/admin/circles/${encodeURIComponent(id)}/roles`, "POST"));
}
