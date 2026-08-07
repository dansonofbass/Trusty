import { proxyGraphPublic } from "@/lib/auth/graphProxy";
import { type NextRequest } from "next/server";

/** Funnel numerator: fired when the survey first renders. */
export function POST(req: NextRequest) {
  return proxyGraphPublic(req, "/public/survey/started", "POST");
}
