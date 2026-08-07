import { type NextRequest } from "next/server";
import { proxyGraphAdmin } from "@/lib/auth/graphProxy";

/** Admin: search specialist-type nodes by label (?q=) for the tag editor. */
export function GET(req: NextRequest) {
  return proxyGraphAdmin(req, `/api/admin/specialists/search${req.nextUrl.search}`, "GET");
}
