import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** List saved contacts. */
export const GET = (req: NextRequest) => proxyGraph(req, "/api/contacts", "GET");

/** Save a contact (SAVED edge) for follow-up. */
export const POST = (req: NextRequest) => proxyGraph(req, "/api/contacts", "POST");
