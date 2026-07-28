import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Peer-confirm a squadmate ({memberId}) — the trust attestation demo. */
export function POST(req: NextRequest) {
  return proxyGraph(req, `/api/squads/confirm`, "POST");
}
