import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** App directory (people/orgs), filterable by ?app=&type=&q=&skill=. */
export const GET = (req: NextRequest) => proxyGraph(req, `/api/directory${req.nextUrl.search}`, "GET");
