import { type NextRequest } from "next/server";
import { proxyGraphAdmin } from "@/lib/auth/graphProxy";

/** Admin: submit a Google/Yandex Maps link → queued to the places connector. */
export async function POST(req: NextRequest) {
  return proxyGraphAdmin(req, "/api/admin/places/link", "POST");
}
