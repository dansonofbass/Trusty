import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** The Trusty Sevan Home feed — all discovery sections in one round-trip. */
export const GET = (req: NextRequest) => proxyGraph(req, `/api/home${req.nextUrl.search}`, "GET");
