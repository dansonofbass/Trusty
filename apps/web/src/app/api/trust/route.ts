import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Trust edges: GET (the viewer's own), POST (create/update), DELETE (remove). */
export const GET = (req: NextRequest) => proxyGraph(req, "/api/trust", "GET");
export const POST = (req: NextRequest) => proxyGraph(req, "/api/trust", "POST");
export const DELETE = (req: NextRequest) => proxyGraph(req, "/api/trust", "DELETE");
