import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Record outcome feedback (👍/👎) on a trust edge. */
export const POST = (req: NextRequest) => proxyGraph(req, "/api/trust/outcome", "POST");
