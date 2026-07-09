"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, X, ArrowRight, Plus } from "lucide-react";
import { adminSubmitLink, adminListLinks, adminDismissLink, type PlaceLink } from "@/lib/placesClient";

const STATUS: Record<string, { label: string; color: string }> = {
  resolved: { label: "✓ imported", color: "#4ade80" },
  failed: { label: "✕ failed", color: "#f87171" },
  queued: { label: "⋯ resolving", color: "#8e97bd" },
};

export default function ImportPage() {
  const [links, setLinks] = useState<PlaceLink[]>([]);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try { setLinks(await adminListLinks()); } catch { /* ignore */ } finally { setLoaded(true); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const submit = async () => {
    const u = url.trim();
    if (!u) return;
    setBusy(true); setError(null);
    try {
      await adminSubmitLink(u);
      setUrl("");
      await load();
      setTimeout(() => void load(), 3000); // resolution is async (connector)
      setTimeout(() => void load(), 8000);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const dismiss = async (id: number) => {
    setLinks((ls) => ls.filter((l) => l.id !== id));
    try { await adminDismissLink(id); } catch { /* ignore */ }
  };

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink" style={{ fontFamily: "var(--font-display)" }}>Import by link</h1>
        <p className="mt-1 text-sm text-dim">Paste a Google Maps or Yandex Maps link. The connector resolves it and imports the restaurant — with SerpApi (Google) it pulls the full feature set.</p>
      </header>

      <section className="rounded-2xl border border-line bg-surface p-5 backdrop-blur-md">
        <div className="flex gap-2">
          <input value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void submit()}
            placeholder="https://maps.app.goo.gl/…  or  https://yandex.com/maps/org/…"
            className="w-full rounded-lg border border-line bg-space/60 px-3 py-2.5 text-[13px] text-ink outline-none focus:border-gold/60" />
          <button onClick={() => void submit()} disabled={busy || !url.trim()}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-gold px-5 py-2.5 font-semibold text-space disabled:opacity-50">
            {busy ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />} Import
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-rose-300">{error}</p>}
      </section>

      <h2 className="mb-3 mt-8 text-[11px] font-semibold uppercase tracking-[0.16em] text-faint">Recent imports</h2>
      {!loaded ? (
        <Loader2 className="animate-spin text-faint" size={16} />
      ) : links.length === 0 ? (
        <p className="text-[13px] text-faint">No imports yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {links.map((l) => {
            const st = STATUS[l.status] ?? STATUS.queued;
            return (
              <li key={l.id} className="flex items-center gap-3 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[12.5px] backdrop-blur-md">
                <span className="rounded-full border border-line px-2 py-0.5 text-[10px] uppercase tracking-wider text-dim">{l.source}</span>
                <span className="min-w-0 flex-1 truncate text-dim" title={l.url}>{l.label ?? l.url}</span>
                <span style={{ color: st.color }}>{l.status === "failed" && l.error ? `✕ ${l.error}` : st.label}</span>
                {l.status === "resolved" && l.nodeId && (
                  <Link href={`/admin/places?edit=${encodeURIComponent(l.nodeId)}`} className="flex items-center gap-0.5 text-faint hover:text-ink">edit <ArrowRight size={13} /></Link>
                )}
                <button onClick={() => void dismiss(l.id)} aria-label="Dismiss" className="text-faint hover:text-rose-300"><X size={14} /></button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
