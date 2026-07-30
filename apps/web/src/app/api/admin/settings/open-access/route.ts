import { type NextRequest } from "next/server";
import { proxyGraphAdmin } from "@/lib/auth/graphProxy";

/** Admin: flip open access ({on: boolean}) — off restores the waitlist. */
export function PUT(req: NextRequest) {
  return proxyGraphAdmin(req, `/api/admin/settings/open-access`, "PUT");
}
