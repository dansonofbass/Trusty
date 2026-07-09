import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Content-based "people to meet" suggestions for the viewer (?app=&skill=&limit=). */
export const GET = (req: NextRequest) => proxyGraph(req, `/api/who-to-meet${req.nextUrl.search}`, "GET");
