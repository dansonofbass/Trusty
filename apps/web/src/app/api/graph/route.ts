import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** App-scoped graph read (REST) — powers the Trusty Sevan graph view
 *  (`?app=summit`) without touching the main GraphQL pipeline. */
export const GET = (req: NextRequest) => proxyGraph(req, `/api/graph${req.nextUrl.search}`, "GET");
