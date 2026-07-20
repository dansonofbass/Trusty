import { type NextRequest } from "next/server";
import { proxyGraphAdmin } from "@/lib/auth/graphProxy";

/** Admin: revoke a verification (license lapsed, source unavailable, …). */
export function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string; vid: string }> }) {
  return ctx.params.then(({ id, vid }) =>
    proxyGraphAdmin(
      req,
      `/api/admin/specialists/${encodeURIComponent(id)}/verifications/${encodeURIComponent(vid)}${req.nextUrl.search}`,
      "DELETE",
    ),
  );
}
