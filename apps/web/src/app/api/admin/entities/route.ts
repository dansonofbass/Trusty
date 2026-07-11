import { type NextRequest } from "next/server";
import { proxyGraphAdmin } from "@/lib/auth/graphProxy";

/** Admin: list people + entities, scoped to an app (?app=&type=&q=). */
export async function GET(req: NextRequest) {
  return proxyGraphAdmin(req, `/api/admin/entities${req.nextUrl.search}`, "GET");
}
