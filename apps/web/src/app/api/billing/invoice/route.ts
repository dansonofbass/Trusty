import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Issue an invoice for a pack. */
export const POST = (req: NextRequest) => proxyGraph(req, "/api/billing/invoice", "POST");
