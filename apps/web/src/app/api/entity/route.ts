import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Create an ontology entity (provider/place) with typed properties. */
export const POST = (req: NextRequest) => proxyGraph(req, "/api/entity", "POST");
