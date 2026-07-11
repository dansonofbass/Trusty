import { type NextRequest } from "next/server";
import { proxyGraphAdmin } from "@/lib/auth/graphProxy";

/** Admin: merged ontology (apps + entity types + field schema). */
export async function GET(req: NextRequest) {
  return proxyGraphAdmin(req, "/api/admin/entities/schema", "GET");
}
