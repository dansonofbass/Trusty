import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Complete onboarding: create the INVITED edge + flip status to active. */
export function POST(req: NextRequest) {
  return proxyGraph(req, "/api/onboarding/complete", "POST");
}
