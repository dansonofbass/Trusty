import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

export function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return ctx.params.then(({ id }) => proxyGraph(req, `/api/conversations/${encodeURIComponent(id)}`, "GET"));
}

export function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return ctx.params.then(({ id }) => proxyGraph(req, `/api/conversations/${encodeURIComponent(id)}`, "PATCH"));
}

export function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return ctx.params.then(({ id }) => proxyGraph(req, `/api/conversations/${encodeURIComponent(id)}`, "DELETE"));
}
