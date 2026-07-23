import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Bulk specialist lifecycle states ({ids}); admins also get subscriptions. */
export function POST(req: NextRequest) {
  return proxyGraph(req, `/api/specialists/states`, "POST", { sendAdminFlag: true });
}
