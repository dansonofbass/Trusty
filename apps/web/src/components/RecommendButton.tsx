"use client";

import { useCallback, useEffect, useState } from "react";
import { Megaphone, X } from "lucide-react";
import { TOPIC_TAXONOMY, reasonsForTopic, type GLink } from "@constellation/graph-core";
import { GOLD, TRUST_ACCENT } from "@/lib/palette";
import { addTrust, listTrust, removeTrust } from "@/lib/trustClient";
import { useUI } from "@/lib/store";
import GeoSelect from "./GeoSelect";
import ContextPickerModal from "./ContextPickerModal";

const endId = (v: string | { id: string }) => (typeof v === "string" ? v : v.id);

/**
 * Recommend — the merged Trust + Recommend action (one form, both artifacts).
 *
 * Saving ALWAYS writes a directed, topic-scoped trust edge (Doc §2, §10–11):
 * your quiet, revocable reliance that powers your network's trust searches.
 * The "Share with listeners" toggle (on by default) ALSO publishes an immutable
 * recommendation (#9/#36) into the feeds of people who listen to you — the
 * public speech act, which can later earn `recommendation_validated`
 * contribution when outcomes verify it. Untick it for quiet trust only.
 *
 * Existing trust on the target is shown as removable chips (removal deletes the
 * edge; published recommendations remain — they're permanent evidence).
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
  const [topic, setTopic] = useState(isPlace ? "restaurant" : "broker");
  // Armenia scope: locations come from the canonical list, preseeded with the
  // viewer's app-wide scope (top-bar selector; default yerevan).
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

  // Follow the app-wide location scope while the form is closed.
  useEffect(() => {
    if (!open) setGeo(geoScope);
  }, [geoScope, open]);

  const toggleReason = (code: string) =>
    setReasons((p) => (p.includes(code) ? p.filter((r) => r !== code) : [...p, code]));

  async function save() {
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
                style={{ borderColor: "rgba(255,140,90,0.45)", color: "var(--color-ink)" }}
              >
                <span>
                  {l.trust?.scope.topic?.replace(/_/g, " ") ?? "trust"}
                  {l.trust?.scope.geo ? ` · ${l.trust.scope.geo}` : ""}
                  {typeof l.trust?.confidence === "number" ? ` · ${Math.round(l.trust.confidence * 100)}%` : ""}
                </span>
                <button
                  type="button"
                  aria-label="Remove trust"
                  disabled={busy}
                  onClick={() => void remove(l.id)}
                  className="text-[var(--color-faint)] hover:text-[#ff9a90]"
                >
                  <X size={11} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {done && (
        <div className="rounded-xl border border-[rgba(255,140,90,0.35)] bg-[rgba(255,140,90,0.06)] px-3 py-2 text-[11.5px] text-ink">
          <Megaphone size={12} className="mr-1.5 inline" style={{ color: GOLD }} />
          {done === "shared" ? (
            <>Recommended — trust recorded, and people who <b>listen to you</b> will see it in their feed.</>
          ) : (
            <>Trust recorded quietly — your network&apos;s searches can now find {targetLabel} through you.</>
          )}
        </div>
      )}

      {err && <p className="text-[11px] text-[#ff9a90]">{err}</p>}

      {!open ? (
        <button
          type="button"
          className={primary ? "btn-accent w-full" : "btn w-full justify-center"}
          style={primary ? undefined : { borderColor: "var(--color-accent-line)", color: "var(--color-accent)" }}
          onClick={() => setOpen(true)}
          title="Record topic-scoped trust — and optionally share it with everyone who listens to you"
        >
          <Megaphone size={13} /> Recommend {isPlace ? "this place" : targetLabel}
        </button>
      ) : (
        <div className="rounded-xl border p-3" style={{ borderColor: "rgba(255,140,90,0.4)", background: "rgba(255,140,90,0.05)" }}>
          <div className="mb-2 text-[12px] font-semibold text-ink">
            Recommend <span style={{ color: GOLD }}>{targetLabel}</span> for…
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <select
              value={topic}
              onChange={(e) => {
                setTopic(e.target.value);
                setReasons([]);
              }}
              className="rounded bg-[rgba(146,166,255,0.08)] px-1.5 py-1 text-[11.5px] text-ink outline-none"
            >
              {TOPIC_TAXONOMY.map((t) => (
                <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
              ))}
            </select>
            <GeoSelect value={geo} onChange={setGeo} />
          </div>
          {/* context — picked in a modal, applies to the whole wizard */}
          <button
            type="button"
            onClick={() => setCtxPickerOpen(true)}
            className="mt-2 flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[11.5px] transition"
            style={
              context
                ? { borderColor: "var(--color-accent-line)", background: "var(--color-accent-soft)" }
                : { borderColor: "var(--color-line)", background: "var(--color-tint-soft)" }
            }
          >
            <span className="text-[13px]">🎯</span>
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
          {ctxPickerOpen && (
            <ContextPickerModal
              topic={topic}
              value={context}
              onPick={setContext}
              onClose={() => setCtxPickerOpen(false)}
            />
          )}
          <div className="mt-2 flex flex-wrap gap-1">
            {reasonsForTopic(topic).slice(0, 8).map((rc) => (
              <button
                key={rc}
                type="button"
                onClick={() => toggleReason(rc)}
                className="rounded-full border px-1.5 py-0.5 text-[10px]"
                style={{
                  borderColor: reasons.includes(rc) ? "rgba(255,140,90,0.6)" : "var(--color-line)",
                  color: reasons.includes(rc) ? "var(--color-ink)" : "var(--color-faint)",
                }}
              >
                {rc.replace(/_/g, " ")}
              </button>
            ))}
          </div>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder={isPlace ? "why (e.g. great for date night)" : "why you recommend them (optional)"}
            className="mt-2 w-full rounded bg-[rgba(146,166,255,0.08)] px-2 py-1.5 text-[11.5px] text-ink outline-none placeholder:text-[var(--color-faint)]"
          />
          <div className="mt-2.5 flex items-center gap-2">
            <span className="text-[10px] text-[var(--color-faint)]">confidence</span>
            <input type="range" min={0.1} max={1} step={0.05} value={confidence} onChange={(e) => setConfidence(Number(e.target.value))} className="flex-1" />
            <span className="w-8 text-right text-[11px] text-ink">{confidence.toFixed(2)}</span>
          </div>
          <label className="mt-2.5 flex cursor-pointer items-center gap-2 text-[11px] text-ink">
            <input
              type="checkbox"
              checked={share}
              onChange={(e) => setShare(e.target.checked)}
              style={{ accentColor: GOLD }}
            />
            <span>
              Share with listeners
              <span className="ml-1 text-[10px] text-[var(--color-faint)]">
                {share ? "— appears in their feed" : "— off: quiet trust, searches only"}
              </span>
            </span>
          </label>
          <div className="mt-2.5 flex gap-2">
            <button type="button" className="btn flex-1 justify-center" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn flex-1 justify-center"
              disabled={busy}
              onClick={() => void save()}
              style={{ background: GOLD, color: "var(--color-space)", borderColor: "transparent" }}
            >
              {busy ? "Saving…" : share ? "Recommend" : "Save quietly"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
