import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Resolve a follow-up prompt: worked (+1) / didn't (-1) / dismissed (0). */
export function POST(req: NextRequest) {
  return proxyGraph(req, "/api/outcomes/resolve", "POST");
}
