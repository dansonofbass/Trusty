"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Megaphone, X } from "lucide-react";
import { TOPIC_TAXONOMY, geoLabel, reasonsForTopic, type GLink } from "@constellation/graph-core";
import { TRUST_ACCENT } from "@/lib/palette";
import { addTrust, listTrust, removeTrust } from "@/lib/trustClient";
import { useUI } from "@/lib/store";
import GeoSelect from "./GeoSelect";
import ContextPickerModal from "./ContextPickerModal";

const endId = (v: string | { id: string }) => (typeof v === "string" ? v : v.id);

/** Glyphs for the field (topic) picker grid. */
const TOPIC_GLYPHS: Record<string, string> = {
  food: "🍜", restaurant: "🍽️", cafe: "☕", doctor: "🩺", dentist: "🦷",
  lawyer: "⚖️", broker: "🏢", real_estate: "🏠", immigration: "🛂",
  mechanic: "🔧", electrician: "⚡", plumber: "🚿", accountant: "🧾",
  shopping: "🛍️", travel: "✈️", fitness: "🏋️", technology: "💻",
  music: "🎵", entertainment: "🎬",
};

/**
 * Recommend — the merged Trust + Recommend action as a MODAL WIZARD (no longer
 * cramped in the side panel):
 *
 *   Step 1 — pick the FIELD (topic) from a glyph grid: what are they good at?
 *   Step 2 — details: location (Armenia scope), context (its own picker modal),
 *            reasons, note, confidence, and the "Share with listeners" toggle.
 *
 * Saving ALWAYS writes the topic-scoped trust edge (quiet, revocable — powers
 * your network's searches); sharing additionally publishes the immutable
 * recommendation into listeners' feeds. The trigger button + existing-trust
 * chips stay inline where the button lives (Inspector / PlaceDetail / PlaceModal).
 */
export default function RecommendButton({
  targetId,
  targetLabel,
  nodeType,
  primary = false,
}: {
  targetId: string;
  targetLabel: string;
  /** Node type of the target — tunes the default topic + copy (place vs person). */
  nodeType?: string;
  /** Render the trigger as the surface's ONE solid primary action. */
  primary?: boolean;
}) {
  const isPlace = nodeType === "location";
  const geoScope = useUI((s) => s.geoScope);
  const [edges, setEdges] = useState<GLink[]>([]);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"field" | "details">("field");
  const [topic, setTopic] = useState<string | null>(isPlace ? "restaurant" : null);
  const [geo, setGeo] = useState(geoScope);
  const [context, setContext] = useState<string | undefined>(undefined);
  const [ctxPickerOpen, setCtxPickerOpen] = useState(false);
  const [confidence, setConfidence] = useState(0.8);
  const [reasons, setReasons] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [share, setShare] = useState(true);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<"shared" | "quiet" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const all = await listTrust();
      setEdges(all.filter((l) => endId(l.target) === targetId));
    } catch {
      /* listing is best-effort */
    }
  }, [targetId]);

  useEffect(() => {
    setOpen(false);
    setReasons([]);
    setDone(null);
    void reload();
  }, [reload]);

  // Follow the app-wide location scope while the wizard is closed.
  useEffect(() => {
    if (!open) setGeo(geoScope);
  }, [geoScope, open]);

  const startWizard = () => {
    setStep(isPlace ? "details" : "field"); // places already imply their field
    setErr(null);
    setOpen(true);
  };

  const pickField = (t: string) => {
    setTopic(t);
    setReasons([]);
    setContext(undefined);
    setStep("details");
  };

  const toggleReason = (code: string) =>
    setReasons((p) => (p.includes(code) ? p.filter((r) => r !== code) : [...p, code]));

  async function save() {
    if (!topic) return;
    setBusy(true);
    setErr(null);
    try {
      // The trust edge is always written — recommending someone IS relying on them.
      await addTrust({
        to: targetId,
        scope: { topic, geo: geo || undefined, context },
        reasons,
        confidence,
        note: note.trim() || undefined,
      });
      // Sharing additionally publishes the immutable recommendation to listeners.
      if (share) {
        const r = await fetch("/api/recs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            targetId,
            topic,
            context,
            reasons,
            note: note.trim() || undefined,
          }),
        });
        if (!r.ok) throw new Error((await r.json()).error ?? "publish failed");
      }
      setDone(share ? "shared" : "quiet");
      setOpen(false);
      setReasons([]);
      setNote("");
      setContext(undefined);
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(linkId: string) {
    setBusy(true);
    try {
      await removeTrust(linkId);
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Trust you already hold (removable — the edge is yours to revoke). */}
      {edges.length > 0 && (
        <div>
          <div className="eyebrow mb-1.5" style={{ color: TRUST_ACCENT }}>
            ✦ You trust {targetLabel}
          </div>
          <ul className="flex flex-wrap gap-1.5">
            {edges.map((l) => (
              <li
                key={l.id}
                className="flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px]"
                style={{ borderColor: "var(--color-accent-line)", color: "var(--color-ink)" }}
              >
                <span>
                  {l.trust?.scope.topic?.replace(/_/g, " ") ?? "trust"}
                  {l.trust?.scope.geo ? ` · ${geoLabel(l.trust.scope.geo)}` : ""}
                  {typeof l.trust?.confidence === "number" ? ` · ${Math.round(l.trust.confidence * 100)}%` : ""}
                </span>
                <button
                  type="button"
                  aria-label="Remove trust"
                  disabled={busy}
                  onClick={() => void remove(l.id)}
                  className="text-[var(--color-faint)] hover:text-[var(--color-danger)]"
                >
                  <X size={11} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {done && (
        <div className="rounded-xl border px-3 py-2 text-[11.5px] text-ink"
          style={{ borderColor: "var(--color-accent-line)", background: "var(--color-accent-soft)" }}>
          <Megaphone size={12} className="mr-1.5 inline" style={{ color: "var(--color-accent)" }} />
          {done === "shared" ? (
            <>Recommended — trust recorded, and people who <b>listen to you</b> will see it in their feed.</>
          ) : (
            <>Trust recorded quietly — your network&apos;s searches can now find {targetLabel} through you.</>
          )}
        </div>
      )}

      {err && !open && <p className="text-[11px] text-[var(--color-danger)]">{err}</p>}

      <button
        type="button"
        className={primary ? "btn-accent w-full" : "btn w-full justify-center"}
        style={primary ? undefined : { borderColor: "var(--color-accent-line)", color: "var(--color-accent)" }}
        onClick={startWizard}
        title="Record topic-scoped trust — and optionally share it with everyone who listens to you"
      >
        <Megaphone size={13} /> Recommend {isPlace ? "this place" : targetLabel}
      </button>

      {/* ------------- the wizard modal ------------- */}
      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-[rgba(4,6,16,0.62)] backdrop-blur-sm" onClick={() => setOpen(false)} aria-hidden />
          <div className="rise relative z-10 flex max-h-[86vh] w-full max-w-[460px] flex-col overflow-hidden rounded-[20px] border border-line bg-[var(--color-card)] shadow-2xl">
            {/* header */}
            <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3">
              {step === "details" && !isPlace && (
                <button type="button" aria-label="Back to field" onClick={() => setStep("field")}
                  className="rounded-lg p-1 text-[var(--color-faint)] hover:bg-[var(--color-tint)] hover:text-ink">
                  <ArrowLeft size={15} />
                </button>
              )}
              <h3 className="min-w-0 flex-1 truncate text-[14.5px] font-extrabold text-ink" style={{ fontFamily: "var(--font-display)" }}>
                Recommend <span style={{ color: "var(--color-accent)" }}>{targetLabel}</span>
              </h3>
              {step === "details" && topic && (
                <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                  style={{ background: "var(--color-accent-soft)", color: "var(--color-accent)" }}>
                  {TOPIC_GLYPHS[topic] ?? ""} {topic.replace(/_/g, " ")}
                </span>
              )}
              <button type="button" aria-label="Close" onClick={() => setOpen(false)}
                className="rounded-lg p-1.5 text-[var(--color-faint)] hover:bg-[var(--color-tint)] hover:text-ink">
                <X size={15} />
              </button>
            </div>

            <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto p-4">
              {step === "field" ? (
                <>
                  <p className="mb-3 text-[12px] text-[var(--color-dim)]">
                    What field are they great at? Trust is scoped — your network finds them for exactly this.
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {TOPIC_TAXONOMY.map((t) => {
                      const active = topic === t;
                      return (
                        <button
                          key={t}
                          type="button"
                          onClick={() => pickField(t)}
                          className="flex flex-col items-center gap-1.5 rounded-2xl border px-2 py-3 text-center transition"
                          style={
                            active
                              ? { borderColor: "var(--color-accent-line)", background: "var(--color-accent-soft)" }
                              : { borderColor: "var(--color-line)", background: "var(--color-tint-soft)" }
                          }
                        >
                          <span className="text-[20px]">{TOPIC_GLYPHS[t] ?? "✦"}</span>
                          <span className="text-[10.5px] font-medium capitalize leading-tight"
                            style={{ color: active ? "var(--color-accent)" : "var(--color-ink)" }}>
                            {t.replace(/_/g, " ")}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : (
                topic && (
                  <div className="space-y-3">
                    {/* location — Armenia scope */}
                    <label className="flex items-center gap-2 text-[11.5px] text-[var(--color-faint)]">
                      <span className="w-16 shrink-0">Where</span>
                      <GeoSelect value={geo} onChange={setGeo}
                        className="min-w-0 flex-1 rounded-lg border border-line bg-[var(--color-tint-soft)] px-2 py-1.5 text-[12px] text-ink outline-none" />
                    </label>

                    {/* context — its own picker modal, applies to the whole wizard */}
                    <button
                      type="button"
                      onClick={() => setCtxPickerOpen(true)}
                      className="flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-[12px] transition"
                      style={
                        context
                          ? { borderColor: "var(--color-accent-line)", background: "var(--color-accent-soft)" }
                          : { borderColor: "var(--color-line)", background: "var(--color-tint-soft)" }
                      }
                    >
                      <span className="text-[14px]">🎯</span>
                      {context ? (
                        <>
                          <span className="min-w-0 flex-1 truncate font-medium capitalize" style={{ color: "var(--color-accent)" }}>
                            {context.replace(/_/g, " ")}
                          </span>
                          <span
                            role="button"
                            aria-label="Clear context"
                            onClick={(e) => {
                              e.stopPropagation();
                              setContext(undefined);
                            }}
                            className="shrink-0 text-[var(--color-faint)] hover:text-ink"
                          >
                            <X size={12} />
                          </span>
                        </>
                      ) : (
                        <span className="min-w-0 flex-1 text-[var(--color-faint)]">
                          What&apos;s this for? — pick a context
                        </span>
                      )}
                    </button>

                    {/* reasons */}
                    <div>
                      <div className="mb-1.5 text-[11px] text-[var(--color-faint)]">Why do you trust them?</div>
                      <div className="flex flex-wrap gap-1">
                        {reasonsForTopic(topic).slice(0, 8).map((rc) => (
                          <button
                            key={rc}
                            type="button"
                            onClick={() => toggleReason(rc)}
                            className="rounded-full border px-2 py-1 text-[10.5px] transition"
                            style={{
                              borderColor: reasons.includes(rc) ? "var(--color-accent-line)" : "var(--color-line)",
                              background: reasons.includes(rc) ? "var(--color-accent-soft)" : "transparent",
                              color: reasons.includes(rc) ? "var(--color-accent)" : "var(--color-faint)",
                            }}
                          >
                            {rc.replace(/_/g, " ")}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* note */}
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      maxLength={500}
                      rows={2}
                      placeholder={isPlace ? "why (e.g. great for date night)" : "why you recommend them (optional)"}
                      className="w-full resize-none rounded-lg border border-line bg-[var(--color-tint-soft)] px-2.5 py-2 text-[12px] text-ink outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-accent-line)]"
                    />

                    {/* confidence */}
                    <div className="flex items-center gap-2">
                      <span className="w-16 shrink-0 text-[11px] text-[var(--color-faint)]">Confidence</span>
                      <input type="range" min={0.1} max={1} step={0.05} value={confidence}
                        onChange={(e) => setConfidence(Number(e.target.value))} className="flex-1"
                        style={{ accentColor: "var(--color-accent)" }} />
                      <span className="w-9 text-right text-[11.5px] text-ink" style={{ fontFamily: "var(--font-mono)" }}>
                        {confidence.toFixed(2)}
                      </span>
                    </div>

                    {/* share toggle */}
                    <label className="flex cursor-pointer items-center gap-2 text-[11.5px] text-ink">
                      <input
                        type="checkbox"
                        checked={share}
                        onChange={(e) => setShare(e.target.checked)}
                        style={{ accentColor: "var(--color-accent)" }}
                      />
                      <span>
                        Share with listeners
                        <span className="ml-1 text-[10.5px] text-[var(--color-faint)]">
                          {share ? "— appears in their feed" : "— off: quiet trust, searches only"}
                        </span>
                      </span>
                    </label>

                    {err && <p className="text-[11px] text-[var(--color-danger)]">{err}</p>}
                  </div>
                )
              )}
            </div>

            {/* footer */}
            {step === "details" && (
              <div className="flex shrink-0 gap-2 border-t border-line px-4 py-3">
                <button type="button" className="btn flex-1 justify-center" onClick={() => setOpen(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-accent flex-1"
                  disabled={busy || !topic}
                  onClick={() => void save()}
                >
                  {busy ? "Saving…" : share ? "Recommend" : "Save quietly"}
                </button>
              </div>
            )}
          </div>

          {ctxPickerOpen && topic && (
            <ContextPickerModal
              topic={topic}
              value={context}
              onPick={setContext}
              onClose={() => setCtxPickerOpen(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}
