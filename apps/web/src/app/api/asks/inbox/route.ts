import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Open asks from your network that you can answer (app-scoped via ?app=). */
export function GET(req: NextRequest) {
  return proxyGraph(req, `/api/asks/inbox${req.nextUrl.search}`, "GET");
}
