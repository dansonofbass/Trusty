import { type NextRequest } from "next/server";
import { proxyGraphAdmin } from "@/lib/auth/graphProxy";

/** Admin: list place edit suggestions (default pending). */
export async function GET(req: NextRequest) {
  return proxyGraphAdmin(req, `/api/admin/place-suggestions${req.nextUrl.search}`, "GET");
}
