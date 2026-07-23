"use client";

import { X } from "lucide-react";

/**
 * Shared chrome for the right-side workspaces (Compose / Asks / Add entity /
 * Invite). One rect, one look — the ActionDock guarantees only one is open at
 * a time (`rightPanel` in the store), so they can all share this shell.
 */
export default function PanelShell({
  title,
  icon,
  onClose,
  children,
  footer,
  headerExtra,
}: {
  title: string;
  icon: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Small controls rendered between the title and the close button. */
  headerExtra?: React.ReactNode;
}) {
  return (
    <aside
      className="rise pointer-events-auto fixed bottom-4 right-4 top-4 z-40 flex w-[400px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-[20px] border border-line shadow-2xl"
      style={{
        background: "color-mix(in srgb, var(--color-card) 95%, transparent)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
      }}
    >
      <div className="flex shrink-0 items-center gap-2.5 border-b border-line px-4 py-3">
        <span
          className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full border border-line"
          style={{ background: "var(--color-tint)", color: "var(--color-accent)" }}
        >
          {icon}
        </span>
        <h2
          className="min-w-0 flex-1 truncate text-[15px] font-extrabold text-ink"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {title}
        </h2>
        {headerExtra}
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="rounded-lg p-1.5 text-[var(--color-faint)] transition hover:bg-[var(--color-tint)] hover:text-ink"
        >
          <X size={16} />
        </button>
      </div>
      <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto">{children}</div>
      {footer && <div className="shrink-0 border-t border-line px-4 py-3">{footer}</div>}
    </aside>
  );
}
