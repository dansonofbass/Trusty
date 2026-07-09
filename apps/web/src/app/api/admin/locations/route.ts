import { type NextRequest } from "next/server";
import { proxyGraphAdmin } from "@/lib/auth/graphProxy";

/** Admin: add/update a meeting venue. */
export const POST = (req: NextRequest) => proxyGraphAdmin(req, "/api/admin/locations", "POST");
