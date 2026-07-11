import { type NextRequest } from "next/server";
import { proxyGraphAdmin } from "@/lib/auth/graphProxy";

/** Admin: create an ontology relation edge between two entities. */
export async function POST(req: NextRequest) {
  return proxyGraphAdmin(req, "/api/admin/relations", "POST");
}
