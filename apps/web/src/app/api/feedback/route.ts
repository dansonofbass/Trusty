import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** In-app feedback → the admin inbox ({text, screen?, app?}). */
export function POST(req: NextRequest) {
  return proxyGraph(req, `/api/feedback`, "POST");
}
