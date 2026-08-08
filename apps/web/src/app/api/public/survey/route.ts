import { type NextRequest } from "next/server";
import { proxyGraphPublic } from "@/lib/auth/graphProxy";

/** Submit the 5-question market-test survey. No login — see proxyGraphPublic. */
export function POST(req: NextRequest) {
  return proxyGraphPublic(req, "/public/survey", "POST");
}
