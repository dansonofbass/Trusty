import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Chat allowance: balance, usage, plans, payment contact, invoices. */
export const GET = (req: NextRequest) => proxyGraph(req, "/api/billing/me", "GET");
