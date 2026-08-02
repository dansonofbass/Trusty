import { type NextRequest } from "next/server";
import { proxyGraphAdmin } from "@/lib/auth/graphProxy";

export const GET = (req: NextRequest) =>
  proxyGraphAdmin(req, `/api/admin/invoices${req.nextUrl.search}`, "GET");
