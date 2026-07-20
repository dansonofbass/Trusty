import { type NextRequest } from "next/server";
import { proxyGraphAdmin } from "@/lib/auth/graphProxy";

/** Admin: the specialist claim review queue (?status=pending|approved|rejected). */
export function GET(req: NextRequest) {
  return proxyGraphAdmin(req, `/api/admin/specialists/claims${req.nextUrl.search}`, "GET");
}
