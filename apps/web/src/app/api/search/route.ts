import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Shared-graph label search (people, places, providers…) — min 2 chars. */
export const GET = (req: NextRequest) => proxyGraph(req, `/api/search${req.nextUrl.search}`, "GET");
