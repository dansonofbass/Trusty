import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** The admin-defined ontology overlay (apps/entity-types/relations) for client hydration. */
export const GET = (req: NextRequest) => proxyGraph(req, "/api/ontology", "GET");
