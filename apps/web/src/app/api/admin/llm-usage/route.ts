import { type NextRequest } from "next/server";
import { proxyGraphAdmin } from "@/lib/auth/graphProxy";

/** Cost insights: totals, by model / day / endpoint / user. */
export const GET = (req: NextRequest) =>
  proxyGraphAdmin(req, `/api/admin/llm-usage${req.nextUrl.search}`, "GET");
