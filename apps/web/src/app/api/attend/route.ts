import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Attend / unattend a workshop or session. */
export const POST = (req: NextRequest) => proxyGraph(req, "/api/attend", "POST");
