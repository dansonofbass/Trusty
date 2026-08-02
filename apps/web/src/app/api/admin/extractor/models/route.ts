import { NextResponse, type NextRequest } from "next/server";
import { readValidSession } from "@/lib/auth/session";
import { isAdmin } from "@/lib/auth/roles";

const EXTRACTOR = process.env.EXTRACTOR_INTERNAL_URL ?? "http://extractor:4003";
const ADMIN_SECRET = process.env.EXTRACTOR_ADMIN_SECRET;

/**
 * Admin-only: the model catalog with LIVE prices (the extractor reads them from
 * LiteLLM, so the comparison table can't drift from what we actually pay).
 */
export async function GET(req: NextRequest) {
  const { session } = await readValidSession(req);
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!(await isAdmin(session))) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  try {
    const upstream = await fetch(`${EXTRACTOR}/admin/models${req.nextUrl.search}`, {
      headers: {
        "x-user-id": session.sub,
        ...(ADMIN_SECRET ? { "x-admin-secret": ADMIN_SECRET } : {}),
      },
      cache: "no-store",
    });
    return new NextResponse(await upstream.text(), {
      status: upstream.status,
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "extractor unreachable" },
      { status: 502 },
    );
  }
}
