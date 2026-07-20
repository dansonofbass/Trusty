"use client";

/**
 * "Is this your professional profile?" — the claim entry point (#39).
 *
 * Renders only on specialist-type nodes. Claiming establishes MANAGEMENT
 * AUTHORITY over provider-controlled fields after admin review — it never
 * verifies service quality and never creates trust, and the copy says so.
 */
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { BadgeCheck, Loader2, X, ExternalLink } from "lucide-react";

const SPECIALIST_TYPES = new Set([
  "lawyer", "broker", "immigration_consultant", "accountant", "doctor",
  "dentist", "mechanic", "plumber", "electrician",
]);

interface ProfileView {
  state: string;
  isManager: boolean;
  pendingClaim: boolean;
}

export default function ClaimProfileButton({ nodeId, nodeType, label, showProfileLink }: {
  nodeId: string;
  nodeType?: string;
  label: string;
  /** Also render a "Full profile →" link to /s/[id] (used in Inspector/NodeSheet,
   *  not on the profile page itself). */
  showProfileLink?: boolean;
}) {
  const [view, setView] = useState<ProfileView | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    professionalEmail: "", phone: "", licenseNumber: "", licenseAuthority: "",
    website: "", organization: "", statement: "",
  });

  const qualifies = !!nodeType && SPECIALIST_TYPES.has(nodeType);

  useEffect(() => {
    if (!qualifies) return;
    let alive = true;
    fetch(`/api/specialists/${encodeURIComponent(nodeId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d) setView(d as ProfileView); })
      .catch(() => {});
    return () => { alive = false; };
  }, [nodeId, qualifies]);

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, string> = {};
      for (const [k, v] of Object.entries(form)) if (v.trim()) body[k] = v.trim();
      const r = await fetch(`/api/specialists/${encodeURIComponent(nodeId)}/claim`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = (await r.json().catch(() => null)) as { error?: string } | null;
      if (!r.ok) throw new Error(d?.error ?? "claim failed");
      setView((v) => (v ? { ...v, pendingClaim: true, state: "claim_requested" } : v));
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [form, nodeId]);

  if (!qualifies || !view) return null;

  const profileLink = showProfileLink ? (
    <Link
      href={`/s/${encodeURIComponent(nodeId)}`}
      className="flex items-center gap-1 text-[11.5px] font-semibold text-[var(--color-accent)] hover:underline"
    >
      Full profile <ExternalLink size={10} />
    </Link>
  ) : null;

  if (view.isManager) {
    return (
      <div className="flex flex-col items-center gap-1.5">
        {profileLink}
        <div className="flex items-center gap-1.5 text-[11.5px] text-[var(--color-accent)]">
          <BadgeCheck size={13} /> You manage this profile
        </div>
      </div>
    );
  }
  if (view.pendingClaim) {
    return (
      <div className="flex flex-col items-center gap-1.5">
        {profileLink}
        <div className="flex items-center gap-1.5 text-[11.5px] text-[var(--color-faint)]">
          <Loader2 size={12} className="animate-spin" /> Claim pending review
        </div>
      </div>
    );
  }

  const field = (key: keyof typeof form, placeholder: string) => (
    <input
      value={form[key]}
      onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
      placeholder={placeholder}
      className="w-full rounded-lg border border-line bg-transparent px-3 py-2 text-[13px] text-ink outline-none placeholder:text-faint focus:border-[var(--color-accent-line)]"
    />
  );

  return (
    <>
      <div className="flex flex-col items-center gap-1.5">
        {profileLink}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-[11.5px] text-[var(--color-faint)] underline decoration-dotted underline-offset-2 hover:text-ink"
        >
          Is this your professional profile? Claim it
        </button>
      </div>
      {open && typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[60] grid place-items-center bg-black/50 p-4" onClick={() => !busy && setOpen(false)}>
            <div
              className="panel w-full max-w-md rounded-2xl p-5"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-label={`Claim ${label}`}
            >
              <div className="flex items-center gap-2">
                <BadgeCheck size={16} style={{ color: "var(--color-accent)" }} />
                <h2 className="text-[15px] font-extrabold text-ink" style={{ fontFamily: "var(--font-display)" }}>
                  Claim {label}
                </h2>
                <button onClick={() => setOpen(false)} aria-label="Close" className="ml-auto text-faint hover:text-ink"><X size={16} /></button>
              </div>
              <p className="mt-2 text-[12px] leading-relaxed text-dim">
                Claiming grants you management of provider-controlled fields after review.
                It does <b className="text-ink">not</b> verify your service quality, does <b className="text-ink">not</b> create
                trust, and never lets you edit independent recommendations or outcomes.
                Provide at least one verifiable anchor:
              </p>
              <div className="mt-3 space-y-2">
                {field("professionalEmail", "Professional email (e.g. you@your-firm.am)")}
                {field("phone", "Publicly listed professional phone")}
                <div className="flex gap-2">
                  {field("licenseNumber", "License number")}
                  {field("licenseAuthority", "Issuing authority")}
                </div>
                {field("website", "Official website")}
                {field("organization", "Organization / firm")}
                <textarea
                  value={form.statement}
                  onChange={(e) => setForm((f) => ({ ...f, statement: e.target.value }))}
                  placeholder="Anything else the reviewer should know (optional)"
                  rows={2}
                  className="w-full resize-none rounded-lg border border-line bg-transparent px-3 py-2 text-[13px] text-ink outline-none placeholder:text-faint focus:border-[var(--color-accent-line)]"
                />
              </div>
              {error && <p className="mt-2 text-[12px] text-rose-300">{error}</p>}
              <button
                type="button"
                disabled={busy}
                onClick={() => void submit()}
                className="mt-3 w-full rounded-xl py-2.5 text-[13.5px] font-bold text-space disabled:opacity-60"
                style={{ background: "var(--color-accent)", fontFamily: "var(--font-display)" }}
              >
                {busy ? "Submitting…" : "Submit claim for review"}
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
