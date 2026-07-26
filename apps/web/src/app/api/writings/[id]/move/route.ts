import { type NextRequest } from "next/server";
import { proxyGraph } from "@/lib/auth/graphProxy";

/** Move a doc into a folder ({folderId} — null/absent = root). */
export function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return ctx.params.then(({ id }) => proxyGraph(req, `/api/writings/${encodeURIComponent(id)}/move`, "PATCH"));
}
