import { type NextRequest } from "next/server";
import { proxyGraphPublic } from "@/lib/auth/graphProxy";

/** Real, trust-ranked specialists matching a topic — no login required (?topic=). */
export function GET(req: NextRequest) {
  return proxyGraphPublic(req, `/public/specialists${req.nextUrl.search}`, "GET");
}
