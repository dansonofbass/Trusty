import { type NextRequest } from "next/server";
import { proxyGraphAdmin } from "@/lib/auth/graphProxy";

/** Admin: recent submitted maps links + their resolution status. */
export async function GET(req: NextRequest) {
  return proxyGraphAdmin(req, `/api/admin/places/links${req.nextUrl.search}`, "GET");
}
