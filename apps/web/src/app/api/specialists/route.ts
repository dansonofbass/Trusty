import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Topic search: admin-tagged, trust-ranked specialists (?topic=&limit=). */
export function GET(req: NextRequest) {
  return proxyGraph(req, `/api/specialists${req.nextUrl.search}`, "GET");
}
