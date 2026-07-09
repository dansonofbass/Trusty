"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, X, Loader2, ShieldCheck } from "lucide-react";
import { adminListSuggestions, adminReviewSuggestion, type PlaceSuggestion } from "@/lib/placesClient";
import Lightbox from "@/components/Lightbox";

const KIND_COLOR: Record<string, string> = { photo: "#3fc6f4", menu: "#54d26e", edit: "#ff8c5a" };

export default function ModerationPage() {
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<PlaceSuggestion[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setItems(await adminListSuggestions("pending")); setStatus("ok"); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); setStatus("error"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const review = async (id: number, action: "approve" | "reject") => {
    setBusy(id);
    setItems((xs) => xs.filter((x) => x.id !== id)); // optimistic
    try { await adminReviewSuggestion(id, action); } catch { await load(); }
    finally { setBusy(null); }
  };

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink" style={{ fontFamily: "var(--font-display)" }}>Moderation</h1>
        <p className="mt-1 text-sm text-dim">Community-submitted photos, dishes, and edits awaiting review.</p>
      </header>

      {status === "loading" && <div className="flex items-center gap-2 text-dim"><Loader2 className="animate-spin" size={16} /> Loading…</div>}
      {status === "error" && <div className="rounded-2xl border border-line bg-surface p-6 text-sm text-rose-300">{error}</div>}

      {status === "ok" && items.length === 0 && (
        <div className="rounded-2xl border border-line bg-surface p-10 text-center backdrop-blur-md">
          <ShieldCheck className="mx-auto mb-3 text-faint" size={28} />
          <p className="text-[14px] text-ink">All clear</p>
          <p className="mt-1 text-[13px] text-faint">Nothing awaiting review.</p>
        </div>
      )}

      {status === "ok" && items.length > 0 && (
        <ul className="space-y-3">
          {items.map((s) => {
            const p = s.patch as Record<string, unknown>;
            return (
              <li key={s.id} className="rounded-2xl border border-line bg-surface p-4 backdrop-blur-md">
                <div className="mb-2 flex items-center gap-2">
                  <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider" style={{ background: `${KIND_COLOR[s.kind] ?? "#8e97bd"}22`, color: KIND_COLOR[s.kind] ?? "#8e97bd" }}>{s.kind}</span>
                  <span className="text-[13.5px] font-semibold text-ink">{s.placeLabel}</span>
                  <span className="ml-auto text-[11px] text-faint">{new Date(s.createdAt).toLocaleDateString()}</span>
                </div>

                {s.kind === "photo" && typeof p.url === "string" && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.url} alt="" onClick={() => setLightbox(p.url as string)} className="mb-2 h-40 w-full cursor-zoom-in rounded-lg object-cover" />
                )}
                {s.kind === "menu" && (
                  <div className="mb-2 flex items-center gap-3">
                    {typeof p.image === "string" && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.image} alt="" onClick={() => setLightbox(p.image as string)} className="h-14 w-14 cursor-zoom-in rounded-md object-cover" />
                    )}
                    <div className="text-[13px] text-ink">
                      {String(p.name ?? "")}{p.price ? <span className="text-dim"> · {String(p.price)}</span> : null}
                      {p.description ? <div className="text-[12px] text-faint">{String(p.description)}</div> : null}
                    </div>
                  </div>
                )}
                {s.kind === "edit" && Object.keys(p).length > 0 && (
                  <pre className="mb-2 overflow-x-auto rounded-lg bg-space/60 p-2.5 text-[11px] text-dim scroll-quiet">{JSON.stringify(p, null, 1)}</pre>
                )}
                {s.note && <div className="mb-2 border-l-2 border-line pl-2.5 text-[12.5px] text-dim">“{s.note}”</div>}

                <div className="flex gap-2">
                  <button disabled={busy === s.id} onClick={() => void review(s.id, "approve")}
                    className="flex items-center gap-1.5 rounded-lg bg-gold px-4 py-1.5 text-[12.5px] font-semibold text-space disabled:opacity-50">
                    <Check size={14} /> Approve
                  </button>
                  <button disabled={busy === s.id} onClick={() => void review(s.id, "reject")}
                    className="flex items-center gap-1.5 rounded-lg border border-line px-4 py-1.5 text-[12.5px] text-dim hover:text-ink disabled:opacity-50">
                    <X size={14} /> Reject
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {lightbox && <Lightbox photos={[lightbox]} onClose={() => setLightbox(null)} />}
    </div>
  );
}
