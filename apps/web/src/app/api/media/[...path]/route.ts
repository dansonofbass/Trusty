import { NextResponse, type NextRequest } from "next/server";
import { readMedia } from "@/lib/uploads";

export const runtime = "nodejs";

/** Serve a stored media file. Public — posted photos are public content. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const media = await readMedia(path ?? []);
  if (!media) return NextResponse.json({ error: "not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(media.bytes), {
    status: 200,
    headers: {
      "content-type": media.contentType,
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
