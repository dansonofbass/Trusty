"use client";

import { useEffect, useState } from "react";
import { Megaphone, PenLine, Plus, UserPlus } from "lucide-react";
import { useUI, type RightPanelId } from "@/lib/store";
import { askInbox } from "@/lib/asksClient";

/**
 * ActionDock — the ONE coordinated creation surface (replaces four scattered,
 * overlapping FABs). Bottom-center, fintech-dock style: Compose is the solid
 * accent primary; the rest are icon buttons with tiny labels. Clicking toggles
 * the matching right-side workspace; the store guarantees mutual exclusion.
 */
const ITEMS: { id: RightPanelId; label: string; icon: React.ElementType; primary?: boolean }[] = [
  { id: "composer", label: "Compose", icon: PenLine, primary: true },
  { id: "addEntity", label: "Add", icon: Plus },
  { id: "asks", label: "Asks", icon: Megaphone },
  { id: "invite", label: "Invite", icon: UserPlus },
];

export default function ActionDock() {
  const rightPanel = useUI((s) => s.rightPanel);
  const toggleRightPanel = useUI((s) => s.toggleRightPanel);
  const [unread, setUnread] = useState(0);

  // Asks badge — refresh on mount and whenever the Asks panel closes.
  useEffect(() => {
    if (rightPanel === "asks") return;
    let alive = true;
    askInbox()
      .then((inbox) => alive && setUnread(inbox.length))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [rightPanel]);

  return (
    <div className="pointer-events-auto fixed bottom-4 left-1/2 z-40 hidden -translate-x-1/2 md:block">
      <div className="panel flex items-end gap-1 rounded-full px-2 py-1.5">
        {ITEMS.map(({ id, label, icon: Icon, primary }) => {
          const active = rightPanel === id;
          return (
            <button
              key={id}
              type="button"
              title={label}
              aria-pressed={active}
              onClick={() => toggleRightPanel(id)}
              className="group relative flex w-[58px] flex-col items-center gap-0.5 rounded-2xl px-1 py-1 transition"
            >
              {primary ? (
                <span
                  className="grid h-[46px] w-[46px] place-items-center rounded-full transition"
                  style={
                    active
                      ? {
                          background: "var(--color-accent-soft)",
                          border: "1px solid var(--color-accent-line)",
                          color: "var(--color-accent)",
                        }
                      : {
                          background: "var(--color-accent)",
                          color: "var(--color-on-accent)",
                          boxShadow: "0 6px 18px rgba(255,140,90,0.3)",
                        }
                  }
                >
                  <Icon size={18} strokeWidth={2.4} />
                </span>
              ) : (
                <span className="icon-btn" data-active={active}>
                  <Icon size={16} strokeWidth={2.2} />
                </span>
              )}
              {id === "asks" && unread > 0 && (
                <span
                  className="absolute right-1.5 top-0 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[9px] font-bold"
                  style={{ background: "var(--color-accent)", color: "var(--color-on-accent)" }}
                >
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
              <span
                className="text-[9.5px] font-medium transition"
                style={{ color: active ? "var(--color-accent)" : "var(--color-faint)" }}
              >
                {label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
