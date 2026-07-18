"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { GEO_OPTIONS, geoLabel } from "@constellation/graph-core";

/**
 * Location select — Trusty explores one country at a time (Armenia, v1).
 * A CUSTOM dropdown (the native <select> menu can't be themed): branded
 * popover with group headers, hover states and a check on the active row.
 * Positioned `fixed` from the trigger's rect so it never gets clipped by
 * scrolling modal bodies, and sits above every overlay (z-90).
 */
export default function GeoSelect({
  value,
  onChange,
  allowAnywhere = false,
  className,
  icon,
}: {
  value: string;
  onChange: (geo: string) => void;
  /** Adds an "anywhere in Armenia" empty option (search scopes). */
  allowAnywhere?: boolean;
  /** Styles the trigger button (defaults to the standard input look). */
  className?: string;
  /** Optional leading icon inside the trigger (e.g. a MapPin in the navbar). */
  icon?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const openMenu = () => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.max(r.width, 230);
    setRect({
      top: r.bottom + 6,
      left: Math.min(r.left, Math.max(8, window.innerWidth - width - 8)),
      width,
    });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  const label = value ? geoLabel(value) : "anywhere in Armenia";

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => {
          // preventDefault: when wrapped in a <label>, the label's activation
          // behavior re-dispatches a click at this button — open+close in one tap.
          e.preventDefault();
          e.stopPropagation();
          if (open) setOpen(false);
          else openMenu();
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex items-center gap-1.5 text-left ${
          className ??
          "rounded-lg border border-line bg-[var(--color-tint-soft)] px-2.5 py-1.5 text-[12px] text-ink outline-none transition hover:border-[var(--color-accent-line)]"
        }`}
        style={open ? { borderColor: "var(--color-accent-line)" } : undefined}
      >
        {icon}
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
        <ChevronDown size={13} className="shrink-0 text-[var(--color-faint)] transition" style={{ transform: open ? "rotate(180deg)" : undefined }} />
      </button>

      {open && rect && createPortal(
        <>
          {/* Portaled to <body>: ancestors with backdrop-filter/transform (the
              PanelShell, modals) would otherwise hijack position:fixed. */}
          <div className="fixed inset-0 z-[89]" onClick={() => setOpen(false)} aria-hidden />
          <div
            role="listbox"
            className="scroll-quiet fixed z-[90] max-h-[300px] overflow-y-auto rounded-2xl border border-line p-1.5 shadow-2xl"
            style={{
              top: rect.top,
              left: rect.left,
              width: rect.width,
              background: "var(--color-card)",
              maxHeight: `min(300px, calc(100vh - ${rect.top + 12}px))`,
            }}
          >
            {allowAnywhere && (
              <OptionRow active={!value} label="Anywhere in Armenia" onClick={() => pick("")} muted />
            )}
            {GEO_OPTIONS.map((g) => (
              <div key={g.label}>
                <div className="px-2.5 pb-1 pt-2 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-[var(--color-faint)]">
                  {g.label}
                </div>
                {g.options.map((o) => (
                  <OptionRow key={o} active={value === o} label={geoLabel(o)} onClick={() => pick(o)} />
                ))}
              </div>
            ))}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

function OptionRow({
  label,
  active,
  onClick,
  muted,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  muted?: boolean;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] transition hover:bg-[var(--color-tint)]"
      style={{
        background: active ? "var(--color-accent-soft)" : undefined,
        color: active ? "var(--color-accent)" : muted ? "var(--color-dim)" : "var(--color-ink)",
      }}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {active && <Check size={13} className="shrink-0" />}
    </button>
  );
}
