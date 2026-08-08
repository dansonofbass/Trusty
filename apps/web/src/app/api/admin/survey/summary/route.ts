import { type NextRequest } from "next/server";
import { proxyGraphAdmin } from "@/lib/auth/graphProxy";

/** Admin: market-test survey funnel, per-question breakdowns, topic coverage. */
export function GET(req: NextRequest) {
  return proxyGraphAdmin(req, "/api/admin/survey/summary", "GET");
}
