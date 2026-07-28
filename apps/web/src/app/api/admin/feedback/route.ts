import { type NextRequest } from "next/server";
import { proxyGraphAdmin } from "@/lib/auth/graphProxy";

/** Admin: everything users sent through the feedback button. */
export function GET(req: NextRequest) {
  return proxyGraphAdmin(req, `/api/admin/feedback`, "GET");
}
