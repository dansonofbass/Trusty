"use client";

import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { useUI } from "@/lib/store";
import { fetchNotifications } from "@/lib/socialClient";

/** Bell button with a live unread badge. Polls lightly (45s + tab focus);
 *  opening the panel marks everything read, so the badge self-clears. */
export default function NotificationBell({ className = "" }: { className?: string }) {
  const rightPanel = useUI((s) => s.rightPanel);
  const setRightPanel = useUI((s) => s.setRightPanel);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetchNotifications()
        .then((r) => alive && setUnread(r.unread))
        .catch(() => {});
    load();
    const t = setInterval(load, 45_000);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [rightPanel]); // re-check when the panel closes (it marked things read)

  return (
    <button
      type="button"
      aria-label="Notifications"
      onClick={() => setRightPanel(rightPanel === "notifications" ? null : "notifications")}
      className={`relative grid h-10 w-10 place-items-center rounded-xl border border-[var(--color-line)] bg-[rgba(146,166,255,0.08)] text-ink transition active:bg-[var(--color-tint)] ${className}`}
    >
      <Bell size={19} strokeWidth={2.2} />
      {unread > 0 && (
        <span
          className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[9.5px] font-bold"
          style={{ background: "var(--color-accent)", color: "var(--color-on-accent)" }}
        >
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </button>
  );
}
