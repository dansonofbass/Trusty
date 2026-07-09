import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Import a user's own places → their trust edges. */
export function POST(req: NextRequest) {
  return proxyGraph(req, "/api/import/places", "POST");
}
