import { type NextRequest } from "next/server";
import { proxyGraphPublic } from "@/lib/auth/graphProxy";

export function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return ctx.params.then(({ id }) =>
    proxyGraphPublic(req, `/public/survey/${encodeURIComponent(id)}/matches-shown`, "POST"),
  );
}
