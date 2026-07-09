import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Predefined meeting venues for the active app. */
export const GET = (req: NextRequest) => proxyGraph(req, `/api/locations${req.nextUrl.search}`, "GET");
