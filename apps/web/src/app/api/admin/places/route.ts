import { type NextRequest } from "next/server";
import { proxyGraphAdmin } from "@/lib/auth/graphProxy";

/** Admin: the entire places catalog (uncapped) for the management list. */
export async function GET(req: NextRequest) {
  return proxyGraphAdmin(req, "/api/admin/places", "GET");
}
