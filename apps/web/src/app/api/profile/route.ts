import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** The viewer's own profile node. */
export const GET = (req: NextRequest) => proxyGraph(req, "/api/profile", "GET");

/** Adopt/update a role + profile fields on the viewer's own person node. */
export const POST = (req: NextRequest) => proxyGraph(req, "/api/profile", "POST");
