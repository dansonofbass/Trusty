import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Broadcast an ask to your network. */
export function POST(req: NextRequest) {
  return proxyGraph(req, `/api/asks${req.nextUrl.search}`, "POST");
}
