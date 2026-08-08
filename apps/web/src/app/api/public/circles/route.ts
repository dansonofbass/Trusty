import { type NextRequest } from "next/server";
import { proxyGraphPublic } from "@/lib/auth/graphProxy";

/** Real, OPEN circles matching a topic — no login required (?topic=). */
export function GET(req: NextRequest) {
  return proxyGraphPublic(req, `/public/circles${req.nextUrl.search}`, "GET");
}
