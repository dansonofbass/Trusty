import { type NextRequest } from "next/server";
import { proxyGraphAdmin } from "@/lib/auth/graphProxy";

/** Admin: runtime platform settings (open-access toggle state). */
export function GET(req: NextRequest) {
  return proxyGraphAdmin(req, `/api/admin/settings`, "GET");
}
