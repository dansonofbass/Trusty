import { type NextRequest } from "next/server";
import { proxyGraphAdmin } from "@/lib/auth/graphProxy";

/** Payment contact (WhatsApp + note) shown on invoices. */
export const PUT = (req: NextRequest) => proxyGraphAdmin(req, "/api/admin/settings/payment", "PUT");
