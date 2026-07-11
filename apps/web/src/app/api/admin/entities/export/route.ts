import { type NextRequest } from "next/server";
import { proxyGraphAdmin } from "@/lib/auth/graphProxy";

/** Admin: export matching entities as import-ready rows (?app=&type=). */
export async function GET(req: NextRequest) {
  return proxyGraphAdmin(req, `/api/admin/entities/export${req.nextUrl.search}`, "GET");
}
