"use client";

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import { TOPIC_TAXONOMY, reasonsForTopic, type GLink } from "@constellation/graph-core";
import { TRUST_ACCENT } from "@/lib/palette";
import { addTrust, listTrust, removeTrust } from "@/lib/trustClient";

const endId = (v: string | { id: string }) => (typeof v === "string" ? v : v.id);

/**
 * Explicit trust on a person/provider (Doc §2, §10–11). Shows the trust you
 * already hold (each removable), and a form to add trust on a new topic. Writes
 * directed trust edges via the BFF; immediately usable in Trust Search.
 */
export default function TrustButton({
  targetId,
  targetLabel,
  nodeType,
}: {
  targetId: string;
  targetLabel: string;
  /** Node type of the target — tunes the default topic + copy (place vs person). */
  nodeType?: string;
}) {
  const isPlace = nodeType === "location";
  const [edges, setEdges] = useState<GLink[]>([]);
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState(isPlace ? "restaurant" : "broker");
  const [geo, setGeo] = useState("");
  const [confidence, setConfidence] = useState(0.8);
  const [reasons, setReasons] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
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
    void reload();
  }, [reload]);

  const toggleReason = (code: string) =>
    setReasons((p) => (p.includes(code) ? p.filter((r) => r !== code) : [...p, code]));

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await addTrust({ to: targetId, scope: { topic, geo: geo.trim() || undefined }, reasons, confidence, note: note.trim() || undefined });
      setOpen(false);
      setReasons([]);
      setNote("");
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
      {/* Trust you already hold */}
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

      {err && <p className="text-[11px] text-[#ff9a90]">{err}</p>}

      {!open ? (
        <button
          type="button"
          className="btn w-full justify-center"
          style={{ borderColor: "rgba(255,140,90,0.5)", color: TRUST_ACCENT }}
          onClick={() => setOpen(true)}
        >
          ✦ {edges.length ? "Add trust" : isPlace ? "Trust this place" : "Trust this person"}
        </button>
      ) : (
        <div className="rounded-xl border p-3" style={{ borderColor: "rgba(255,140,90,0.4)", background: "rgba(255,140,90,0.05)" }}>
          <div className="mb-2 text-[12px] font-semibold text-ink">
            Trust <span style={{ color: TRUST_ACCENT }}>{targetLabel}</span> for…
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
            <input
              value={geo}
              onChange={(e) => setGeo(e.target.value)}
              placeholder="place (optional)"
              className="w-28 rounded bg-[rgba(146,166,255,0.08)] px-1.5 py-1 text-[11.5px] text-ink outline-none"
            />
          </div>
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
            maxLength={140}
            placeholder={isPlace ? "a note (e.g. great for date night)" : "a note (optional)"}
            className="mt-2 w-full rounded bg-[rgba(146,166,255,0.08)] px-2 py-1.5 text-[11.5px] text-ink outline-none placeholder:text-[var(--color-faint)]"
          />
          <div className="mt-2.5 flex items-center gap-2">
            <span className="text-[10px] text-[var(--color-faint)]">confidence</span>
            <input type="range" min={0.1} max={1} step={0.05} value={confidence} onChange={(e) => setConfidence(Number(e.target.value))} className="flex-1" />
            <span className="w-8 text-right text-[11px] text-ink">{confidence.toFixed(2)}</span>
          </div>
          <div className="mt-2.5 flex gap-2">
            <button type="button" className="btn flex-1 justify-center" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn flex-1 justify-center"
              disabled={busy}
              onClick={() => void save()}
              style={{ background: TRUST_ACCENT, color: "var(--color-space)", borderColor: "transparent" }}
            >
              {busy ? "Saving…" : "Save trust"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
