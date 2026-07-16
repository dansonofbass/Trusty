import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** The viewer's front-door state: account status + config + referral progress.
 * Admins are exempt from the gate — the verified admin flag lets graph-service
 * auto-activate them so they never see the waitlist or onboarding walls. */
export function GET(req: NextRequest) {
  return proxyGraph(req, "/api/access", "GET", { sendAdminFlag: true });
}
