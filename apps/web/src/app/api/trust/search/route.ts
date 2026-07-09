import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Trust-ranked search: resolve a scope → trust-transferred recommendations. */
export const POST = (req: NextRequest) => proxyGraph(req, "/api/trust-search", "POST");
