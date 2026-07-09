"use client";

import { useState } from "react";
import { X, Upload, Loader2, Check } from "lucide-react";
import { GOLD, TRUST_ACCENT } from "@/lib/palette";
import { useUI } from "@/lib/store";
import { importPlaces, parseImportText, type ImportPlace } from "@/lib/importClient";

/**
 * Import your own places → your trust edges. Paste a JSON list or upload a
 * Google Takeout / Foursquare export; each resolved place becomes a trust edge
 * you own, so your trust-search + galaxy fill immediately. Ratings map to
 * confidence — this is YOUR taste, not anonymous crowd stars.
 */
export default function ImportPlaces({ open, onClose }: { open: boolean; onClose: () => void }) {
  const bumpGraph = useUI((s) => s.bumpGraph);
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<ImportPlace[]>([]);
  const [parseErr, setParseErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ imported: number; created: number } | null>(null);

  if (!open) return null;

  const reparse = (t: string) => {
    setText(t);
    setDone(null);
    if (!t.trim()) {
      setParsed([]);
      setParseErr(null);
      return;
    }
    try {
      setParsed(parseImportText(t));
      setParseErr(null);
    } catch {
      setParsed([]);
      setParseErr("That doesn't look like valid JSON.");
    }
  };

  const onFile = async (f: File | undefined) => {
    if (f) reparse(await f.text());
  };

  const submit = async () => {
    if (!parsed.length || busy) return;
    setBusy(true);
    try {
      const r = await importPlaces(parsed);
      setDone({ imported: r.imported, created: r.created });
      bumpGraph();
    } catch (e) {
      setParseErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-t-3xl border border-line bg-nebula/95 p-5 shadow-2xl backdrop-blur-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
        style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-[16px] font-extrabold text-ink" style={{ fontFamily: "var(--font-display)" }}>
              Import your places
            </h2>
            <p className="mt-1 text-[12.5px] leading-relaxed text-dim">
              Paste a list, or upload a Google Takeout / Foursquare export. Each becomes a
              place <b>you trust</b> — instantly powering your searches.
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-faint hover:text-ink">
            <X size={16} />
          </button>
        </div>

        {done ? (
          <div className="mt-4 rounded-xl border p-4 text-center" style={{ borderColor: TRUST_ACCENT }}>
            <Check size={20} className="mx-auto" style={{ color: TRUST_ACCENT }} />
            <p className="mt-2 text-[14px] text-ink">
              Imported <b>{done.imported}</b> places ({done.created} new to the catalog). Your trust
              search just got smarter.
            </p>
            <button type="button" onClick={onClose} className="mt-3 text-[13px] text-dim underline hover:text-ink">
              Done
            </button>
          </div>
        ) : (
          <>
            <label className="mt-4 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-line py-3 text-[13px] text-dim hover:border-gold/50">
              <Upload size={15} /> Upload a .json export
              <input
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => onFile(e.target.files?.[0])}
              />
            </label>
            <div className="my-2 text-center text-[11px] text-faint">or paste</div>
            <textarea
              value={text}
              onChange={(e) => reparse(e.target.value)}
              placeholder={'[{"name":"Lavash","geo":"Yerevan","rating":5}]'}
              className="h-28 w-full rounded-xl border border-line bg-space/60 p-3 text-[12.5px] text-ink outline-none focus:border-gold/50"
            />
            {parseErr && <p className="mt-1 text-[12px] text-rose-300">{parseErr}</p>}
            <div className="mt-3 flex items-center justify-between">
              <span className="text-[12px] text-faint">
                {parsed.length > 0 ? `${parsed.length} places ready` : "nothing parsed yet"}
              </span>
              <button
                type="button"
                onClick={submit}
                disabled={!parsed.length || busy}
                className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-[14px] font-bold text-space disabled:opacity-50"
                style={{ background: GOLD, fontFamily: "var(--font-display)" }}
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : null}
                Import {parsed.length || ""}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
