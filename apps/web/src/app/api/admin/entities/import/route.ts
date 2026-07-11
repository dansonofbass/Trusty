import { type NextRequest } from "next/server";
import { proxyGraphAdmin } from "@/lib/auth/graphProxy";

/** Admin: bulk-create entities from rows [{entityType,label,properties}]. */
export async function POST(req: NextRequest) {
  return proxyGraphAdmin(req, "/api/admin/summit/import", "POST");
}
