import { NextResponse, type NextRequest } from "next/server";
import { readValidSession } from "@/lib/auth/session";
import { saveUpload } from "@/lib/uploads";

export const runtime = "nodejs";

/** Upload an image → returns a same-origin URL. Callers then attach it (to a
 *  place's photos, a dish, …). Authed; storage lives on the BFF's uploads volume. */
export async function POST(req: NextRequest) {
  const { session } = await readValidSession(req);
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  try {
    const form = await req.formData();
    const file = form.get("file");
    const subdir = String(form.get("subdir") ?? "uploads");
    if (!(file instanceof File)) return NextResponse.json({ error: "file required" }, { status: 400 });
    const saved = await saveUpload(file, subdir);
    return NextResponse.json(saved);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "upload failed" }, { status: 400 });
  }
}
