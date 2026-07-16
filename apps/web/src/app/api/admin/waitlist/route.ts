import { type NextRequest } from "next/server";
import { proxyGraphAdmin } from "@/lib/auth/graphProxy";

/** Admin: list everyone currently held at the front door. */
export function GET(req: NextRequest) {
  return proxyGraphAdmin(req, "/api/admin/waitlist", "GET");
}
