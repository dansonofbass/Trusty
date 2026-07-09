import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Save a meeting note (private text + confirmed entities → graph edges). */
export const POST = (req: NextRequest) => proxyGraph(req, "/api/notes", "POST");
