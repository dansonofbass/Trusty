import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** The viewer's saved places (bookmark list), hydrated with node identity. */
export async function GET(req: NextRequest) {
  return proxyGraph(req, "/api/places/saved/list", "GET");
}
