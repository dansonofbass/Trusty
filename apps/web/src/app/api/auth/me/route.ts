import { NextResponse, type NextRequest } from "next/server";
import { readSession } from "@/lib/auth/session";

/** The signed-in user (for the UI header). 401 when not authenticated. */
export async function GET(req: NextRequest) {
  const s = await readSession(req);
  if (!s) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  return NextResponse.json({ sub: s.sub, name: s.name, email: s.email });
}
