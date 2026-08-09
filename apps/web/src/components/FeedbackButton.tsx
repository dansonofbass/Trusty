"use client";

/**
 * The feedback action button (summit demo → keeper): one tap, a textarea,
 * straight to the admin inbox with the screen it was sent from.
 */
import { useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { Loader2, MessageSquarePlus, X } from "lucide-react";
import { useT } from "@/lib/i18n";

export default function FeedbackButton({ compact }: { compact?: boolean }) {
  const t = useT();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const send = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const r = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, screen: pathname }),
      });
      if (r.ok) {
        setSent(true);
        setText("");
        setTimeout(() => {
          setSent(false);
          setOpen(false);
        }, 1200);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t("feedback.send")}
        aria-label={t("feedback.send")}
        className={
          compact
            ? "rounded-lg border border-line p-1.5 text-[var(--color-faint)] transition hover:text-ink"
            : "flex w-full items-center gap-2 rounded-xl border border-dashed border-[var(--color-line)] px-3 py-2 text-[12px] text-[var(--color-faint)] transition hover:border-[var(--color-accent-line)] hover:text-ink"
        }
      >
        <MessageSquarePlus size={compact ? 14 : 13} />
        {!compact && t("feedback.button")}
      </button>
      {open && typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[70] grid place-items-center bg-black/50 p-4" onClick={() => !busy && setOpen(false)}>
            <div className="panel w-full max-w-sm rounded-2xl p-4" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t("feedback.send")}>
              <div className="flex items-center gap-2">
                <MessageSquarePlus size={15} style={{ color: "var(--color-accent)" }} />
                <span className="text-[14px] font-extrabold text-ink" style={{ fontFamily: "var(--font-display)" }}>
                  {t("feedback.title")}
                </span>
                <button onClick={() => setOpen(false)} aria-label={t("common.close")} className="ms-auto text-faint hover:text-ink"><X size={15} /></button>
              </div>
              <textarea
                autoFocus
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={4}
                placeholder={t("feedback.placeholder")}
                className="mt-3 w-full resize-none rounded-lg border border-line bg-transparent px-3 py-2 text-[13px] text-ink outline-none placeholder:text-faint focus:border-[var(--color-accent-line)]"
              />
              <button
                type="button"
                disabled={busy || !text.trim()}
                onClick={() => void send()}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl py-2 text-[13px] font-bold text-space disabled:opacity-50"
                style={{ background: sent ? "#54d26e" : "var(--color-accent)", fontFamily: "var(--font-display)" }}
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : null}
                {sent ? t("feedback.thanks") : t("feedback.submit")}
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
