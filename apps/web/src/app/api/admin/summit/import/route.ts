import { type NextRequest } from "next/server";
import { proxyGraphAdmin } from "@/lib/auth/graphProxy";

/** Admin: bulk-import entities into an app. */
export const POST = (req: NextRequest) => proxyGraphAdmin(req, "/api/admin/summit/import", "POST");
