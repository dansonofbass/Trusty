import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** The viewer's meetings (incoming + outgoing). */
export const GET = (req: NextRequest) => proxyGraph(req, "/api/meetings", "GET");

/** Request a 1:1 with someone. */
export const POST = (req: NextRequest) => proxyGraph(req, "/api/meetings", "POST");
