import { NextResponse, type NextRequest } from "next/server";
import { readValidSession } from "@/lib/auth/session";
import { isAdmin } from "@/lib/auth/roles";

/** Whether the current session is an admin — gates the admin dashboard shell. */
export async function GET(req: NextRequest) {
  const { session } = await readValidSession(req);
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!(await isAdmin(session))) return NextResponse.json({ admin: false }, { status: 403 });
  return NextResponse.json({ admin: true, name: session.name ?? null, email: session.email ?? null });
}
