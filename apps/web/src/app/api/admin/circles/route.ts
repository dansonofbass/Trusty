import { type NextRequest } from "next/server";
import { proxyGraphAdmin } from "@/lib/auth/graphProxy";

/** Admin: circles across every space (?app=), with member counts. */
export function GET(req: NextRequest) {
  return proxyGraphAdmin(req, `/api/admin/circles${req.nextUrl.search}`, "GET");
}
