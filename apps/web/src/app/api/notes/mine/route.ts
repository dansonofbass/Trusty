import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** The viewer's notes journal. */
export const GET = (req: NextRequest) => proxyGraph(req, "/api/notes/mine", "GET");
