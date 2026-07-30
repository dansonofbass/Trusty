import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Space-scoped saved-answer search. */
export function GET(req: NextRequest) {
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return proxyGraph(req, `/api/answers/search?q=${encodeURIComponent(q)}`, "GET");
}
