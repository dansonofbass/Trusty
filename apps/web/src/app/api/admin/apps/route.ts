import { type NextRequest } from "next/server";
import { proxyGraph, proxyGraphAdmin } from "@/lib/auth/graphProxy";

/** List admin-defined apps (any authed user may read; editing is admin-gated). */
export const GET = (req: NextRequest) => proxyGraph(req, "/api/admin/apps", "GET");

/** Admin: create/update an app. */
export const POST = (req: NextRequest) => proxyGraphAdmin(req, "/api/admin/apps", "POST");
