"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, BookmarkCheck, Handshake, MessageCircle, ShieldCheck, Sparkles, UserPlus, Users } from "lucide-react";
import PanelShell from "./dock/PanelShell";
import { useUI } from "@/lib/store";
import {
  fetchNotifications,
  markNotificationsRead,
  type NotificationItem,
} from "@/lib/socialClient";

const TYPE_ICON: Record<string, React.ElementType> = {
  contact: UserPlus,
  squad: Users,
  confirm: ShieldCheck,
  trust: Handshake,
  meeting: MessageCircle,
  rec: Sparkles,
  listen: Bell,
  startup: Users,
  circle: Users,
  answer: BookmarkCheck,
};

function timeAgo(iso: string): string {
  const s = Math.max(1, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/** The bell's panel: who connected with / confirmed / trusted / messaged you.
 *  Opening it marks everything read (the badge is the unread signal). */
export default function NotificationsPanel() {
  const open = useUI((s) => s.rightPanel === "notifications");
  const setRightPanel = useUI((s) => s.setRightPanel);
  const select = useUI((s) => s.select);
  const router = useRouter();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetchNotifications()
      .then((r) => {
        if (!alive) return;
        setItems(r.items);
        setLoaded(true);
        if (r.unread > 0) void markNotificationsRead().catch(() => {});
      })
      .catch(() => setLoaded(true));
    return () => {
      alive = false;
    };
  }, [open]);

  if (!open) return null;

  const openItem = (n: NotificationItem) => {
    setRightPanel(null);
    if (n.type === "squad" || n.type === "startup" || n.type === "circle") {
      router.push("/messages");
    } else if (n.actorId) {
      select(n.actorId); // opens the Inspector on the actor
    }
  };

  return (
    <PanelShell title="Notifications" icon={<Bell size={15} />} onClose={() => setRightPanel(null)}>
      {!loaded ? (
        <p className="px-1 py-2 text-[12px] text-[var(--color-faint)]">Loading…</p>
      ) : items.length === 0 ? (
        <div className="px-1 py-6 text-center">
          <Bell size={22} className="mx-auto mb-2 text-[var(--color-faint)]" />
          <p className="text-[12.5px] text-[var(--color-dim)]">
            Nothing yet. When someone connects with you, confirms your squad, trusts you or asks to
            meet, it lands here.
          </p>
        </div>
      ) : (
        <ul className="space-y-1">
          {items.map((n) => {
            const Icon = TYPE_ICON[n.type] ?? Bell;
            return (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => openItem(n)}
                  className="flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition hover:bg-[var(--color-tint)]"
                  style={n.read ? undefined : { background: "var(--color-accent-soft)" }}
                >
                  <span
                    className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full"
                    style={{ background: "rgba(146,166,255,0.12)", color: "var(--color-accent)" }}
                  >
                    <Icon size={13} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] leading-snug text-ink">{n.text}</span>
                    <span className="mt-0.5 block text-[10.5px] text-[var(--color-faint)]">
                      {timeAgo(n.createdAt)} ago
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </PanelShell>
  );
}
