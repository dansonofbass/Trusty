import { type NextRequest } from "next/server";
import { proxyGraphAdmin } from "@/lib/auth/graphProxy";

/** Admin: every user's contribution score (algorithm monitoring). */
export function GET(req: NextRequest) {
  return proxyGraphAdmin(req, "/api/admin/contribution", "GET");
}

/** Admin: re-score everyone with a simulated config override (tuning). */
export function POST(req: NextRequest) {
  return proxyGraphAdmin(req, "/api/admin/contribution", "POST");
}
