"use client";

import { useState } from "react";
import { Megaphone } from "lucide-react";
import { TOPIC_TAXONOMY, reasonsForTopic } from "@constellation/graph-core";
import { GOLD } from "@/lib/palette";

/**
 * Publish a recommendation for this node (#9/#36) — an immutable knowledge
 * entity with topic/context/reasons. THIS is what reaches the feeds of people
 * who listen to you (and can later earn you `recommendation_validated`
 * contribution when their outcomes verify it). Distinct from Trust (your
 * private reliance) and from Listen (their permission to hear you).
 */
export default function RecommendButton({
  targetId,
  targetLabel,
  nodeType,
}: {
  targetId: string;
  targetLabel: string;
  nodeType?: string;
}) {
  const isPlace = nodeType === "location";
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState(isPlace ? "restaurant" : "broker");
  const [context, setContext] = useState("");
  const [reasons, setReasons] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const toggleReason = (code: string) =>
    setReasons((p) => (p.includes(code) ? p.filter((r) => r !== code) : [...p, code]));

  async function publish() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/recs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          targetId,
          topic,
          context: context.trim() || undefined,
          reasons,
          note: note.trim() || undefined,
        }),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "publish failed");
      setDone(true);
      setOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-xl border border-[rgba(255,217,122,0.35)] bg-[rgba(255,217,122,0.06)] px-3 py-2 text-[11.5px] text-ink">
        <Megaphone size={12} className="mr-1.5 inline" style={{ color: GOLD }} />
        Published — people who <b>listen to you</b> will see this in their feed.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {err && <p className="text-[11px] text-[#ff9a90]">{err}</p>}
      {!open ? (
        <button
          type="button"
          className="btn w-full justify-center"
          style={{ borderColor: "rgba(255,217,122,0.5)", color: GOLD }}
          onClick={() => setOpen(true)}
          title="Share this as knowledge — reaches everyone who listens to you"
        >
          <Megaphone size={13} /> Recommend {isPlace ? "this place" : targetLabel}
        </button>
      ) : (
        <div className="rounded-xl border p-3" style={{ borderColor: "rgba(255,217,122,0.4)", background: "rgba(255,217,122,0.05)" }}>
          <div className="mb-2 text-[12px] font-semibold text-ink">
            Recommend <span style={{ color: GOLD }}>{targetLabel}</span> for…
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <select
              value={topic}
              onChange={(e) => { setTopic(e.target.value); setReasons([]); }}
              className="rounded bg-[rgba(146,166,255,0.08)] px-1.5 py-1 text-[11.5px] text-ink outline-none"
            >
              {TOPIC_TAXONOMY.map((t) => (
                <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
              ))}
            </select>
            <input
              value={context}
              onChange={(e) => setContext(e.target.value)}
              maxLength={120}
              placeholder="context (e.g. family visa case)"
              className="w-40 rounded bg-[rgba(146,166,255,0.08)] px-1.5 py-1 text-[11.5px] text-ink outline-none"
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
                  borderColor: reasons.includes(rc) ? "rgba(255,217,122,0.6)" : "var(--color-line)",
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
            placeholder="why you recommend them (optional)"
            className="mt-2 w-full rounded bg-[rgba(146,166,255,0.08)] px-2 py-1.5 text-[11.5px] text-ink outline-none placeholder:text-[var(--color-faint)]"
          />
          <div className="mt-2.5 flex gap-2">
            <button type="button" className="btn flex-1 justify-center" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn flex-1 justify-center"
              disabled={busy}
              onClick={() => void publish()}
              style={{ background: GOLD, color: "var(--color-space)", borderColor: "transparent" }}
            >
              {busy ? "Publishing…" : "Publish"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
