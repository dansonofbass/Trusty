import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

export function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return ctx.params.then(({ id }) => proxyGraph(req, `/api/writings/folders/${encodeURIComponent(id)}`, "PATCH"));
}

export function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return ctx.params.then(({ id }) => proxyGraph(req, `/api/writings/folders/${encodeURIComponent(id)}`, "DELETE"));
}
