import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

export function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return ctx.params.then(({ id }) => {
    const before = new URL(req.url).searchParams.get("before");
    const qs = before ? `?before=${encodeURIComponent(before)}` : "";
    return proxyGraph(req, `/api/rooms/${encodeURIComponent(id)}/messages${qs}`, "GET");
  });
}

export function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return ctx.params.then(({ id }) => proxyGraph(req, `/api/rooms/${encodeURIComponent(id)}/messages`, "POST"));
}
