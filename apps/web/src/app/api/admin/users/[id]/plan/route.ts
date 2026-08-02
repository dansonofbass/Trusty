import { type NextRequest } from "next/server";
import { proxyGraphAdmin } from "@/lib/auth/graphProxy";

/** Set a user's plan tier (free / premium) — decides which model answers them. */
export function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return ctx.params.then(({ id }) =>
    proxyGraphAdmin(req, `/api/admin/users/${encodeURIComponent(id)}/plan`, "PUT"),
  );
}
