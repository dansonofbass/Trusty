import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** The event programme (workshops/sessions + attendance). */
export const GET = (req: NextRequest) => proxyGraph(req, `/api/programme${req.nextUrl.search}`, "GET");
