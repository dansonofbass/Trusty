"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, MessagesSquare, ShieldQuestion, X } from "lucide-react";
import { TOPIC_TAXONOMY } from "@constellation/graph-core";
import { GOLD } from "@/lib/palette";
import GeoSelect from "../GeoSelect";
import { routeQuestion, type CircleCandidate } from "@/lib/forumRouteClient";
import { useT, type Translate } from "@/lib/i18n";

/**
 * Confirm card for gated agent actions (#29) — outward-facing tools (publish,
 * ask, trust, listen) never auto-execute. The agent proposes args; the user can
 * edit the human fields (topic/geo/note) before approving. Deny feeds a reason
 * back to the model so it adapts instead of retrying.
 */
export interface PendingConfirm {
  id: string;
  tool: string;
  args: unknown;
  title: string;
  description: string;
  decided?: "approved" | "denied";
}

/** Arg keys the user may edit on the card, in display order. */
const EDITABLE_KEYS = ["topic", "geo", "note"] as const;

/** Args that are plumbing, not something to show a human. */
const HIDDEN_KEYS = new Set(["circleId", "tags", "title", "body", "specialistId", "slotId"]);

export default function ConfirmCard({
  confirm,
  busy,
  onDecide,
}: {
  confirm: PendingConfirm;
  busy: boolean;
  onDecide: (approved: boolean, args?: unknown) => void;
}) {
  const t = useT();
  const baseArgs =
    confirm.args && typeof confirm.args === "object" ? (confirm.args as Record<string, unknown>) : {};
  const [edits, setEdits] = useState<Record<string, string>>({});
  // ask_forum: which circle this lands in is THE decision on this card, so it
  // is chosen here rather than guessed by the model (see ForumRouteChooser).
  const [circle, setCircle] = useState<CircleCandidate | null>(null);

  const value = (k: string) => edits[k] ?? (typeof baseArgs[k] === "string" ? (baseArgs[k] as string) : "");
  const mergedArgs = () => {
    const out: Record<string, unknown> = { ...baseArgs };
    for (const [k, v] of Object.entries(edits)) {
      if (v.trim()) out[k] = v.trim();
      else delete out[k];
    }
    if (confirm.tool === "ask_forum" && circle) {
      out.circleId = circle.circleId;
      if (circle.matchedTags.length) out.tags = circle.matchedTags;
    }
    return out;
  };

  if (confirm.decided) {
    return (
      <div className="mt-2 flex items-center gap-1.5 rounded-lg border border-line bg-space/40 px-2.5 py-1.5 text-[11.5px] text-[var(--color-faint)]">
        {confirm.decided === "approved" ? <Check size={12} className="text-[#54d26e]" /> : <X size={12} />}
        {confirm.title} — {t(confirm.decided === "approved" ? "confirm.approved" : "confirm.denied")}
      </div>
    );
  }

  const isForum = confirm.tool === "ask_forum";

  return (
    <div className="mt-2 rounded-xl border p-3" style={{ borderColor: "rgba(255,140,90,0.45)", background: "rgba(255,140,90,0.06)" }}>
      <div className="flex items-center gap-1.5 text-[12.5px] font-bold text-ink">
        <ShieldQuestion size={14} style={{ color: GOLD }} /> {confirm.title}
      </div>
      <p className="mt-1 text-[11px] leading-snug text-[var(--color-dim)]">{confirm.description}</p>

      {isForum && (
        <ForumRouteChooser
          text={`${String(baseArgs.title ?? "")}\n${String(baseArgs.body ?? "")}`}
          preset={typeof baseArgs.circleId === "string" ? baseArgs.circleId : undefined}
          selected={circle}
          onSelect={setCircle}
          t={t}
        />
      )}

      {isForum && typeof baseArgs.title === "string" && (
        <p dir="auto" className="mt-2 rounded-lg bg-[var(--color-tint-soft)] px-2.5 py-2 text-[12px] leading-relaxed text-ink">
          {baseArgs.title}
        </p>
      )}

      <div className="mt-2 space-y-1.5">
        {EDITABLE_KEYS.filter((k) => k in baseArgs || (k === "note" && !isForum)).map((k) =>
          k === "topic" ? (
            <label key={k} className="flex items-center gap-2 text-[11px] text-[var(--color-faint)]">
              <span className="w-12 shrink-0">{t("confirm.topic")}</span>
              <select
                value={value(k)}
                onChange={(e) => setEdits((p) => ({ ...p, [k]: e.target.value }))}
                className="min-w-0 flex-1 rounded-lg border border-line bg-space/60 px-2 py-1 text-ink"
              >
                {[value(k), ...TOPIC_TAXONOMY.filter((x) => x !== value(k))].filter(Boolean).map((x) => (
                  <option key={x} value={x}>{x.replace(/_/g, " ")}</option>
                ))}
              </select>
            </label>
          ) : k === "geo" ? (
            <div key={k} className="flex items-center gap-2 text-[11px] text-[var(--color-faint)]">
              <span className="w-12 shrink-0">{t("confirm.geo")}</span>
              <GeoSelect
                value={value(k)}
                onChange={(geo) => setEdits((p) => ({ ...p, [k]: geo }))}
                allowAnywhere
                className="min-w-0 flex-1 rounded-lg border border-line bg-space/60 px-2 py-1 text-ink outline-none"
              />
            </div>
          ) : (
            <label key={k} className="flex items-center gap-2 text-[11px] text-[var(--color-faint)]">
              <span className="w-12 shrink-0">{t("confirm.note")}</span>
              <input
                dir="auto"
                value={value(k)}
                onChange={(e) => setEdits((p) => ({ ...p, [k]: e.target.value }))}
                placeholder={t("confirm.optional")}
                className="min-w-0 flex-1 rounded-lg border border-line bg-space/60 px-2 py-1 text-ink outline-none placeholder:text-[var(--color-faint)]"
              />
            </label>
          ),
        )}
        {/* Non-editable args (ids etc.) shown for transparency. */}
        {Object.entries(baseArgs)
          .filter(([k]) => !(EDITABLE_KEYS as readonly string[]).includes(k) && !HIDDEN_KEYS.has(k))
          .map(([k, v]) => (
            <div key={k} className="flex items-center gap-2 text-[10.5px] text-[var(--color-faint)]">
              <span className="w-12 shrink-0">{k}</span>
              <span className="truncate" style={{ fontFamily: "var(--font-mono)" }}>{typeof v === "string" ? v : JSON.stringify(v)}</span>
            </div>
          ))}
      </div>

      <div className="mt-2.5 flex items-center gap-2">
        <button
          type="button"
          disabled={busy || (isForum && !circle)}
          onClick={() => onDecide(true, mergedArgs())}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-bold text-space disabled:opacity-50"
          style={{ background: GOLD }}
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} {t("confirm.approve")}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onDecide(false)}
          className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[12px] font-semibold text-[var(--color-dim)] hover:text-ink disabled:opacity-50"
        >
          <X size={13} /> {t("confirm.notNow")}
        </button>
      </div>
    </div>
  );
}

/**
 * Which circle does this question go to?
 *
 * The card does the routing itself rather than trusting an id from the model:
 * the ranking is a graph query over the space's real circles and their tags,
 * and it comes back with reasons, so a wrong pick is visible and one tap from
 * being corrected. Nothing posts until a circle is selected.
 */
function ForumRouteChooser({
  text,
  preset,
  selected,
  onSelect,
  t,
}: {
  text: string;
  preset?: string;
  selected: CircleCandidate | null;
  onSelect: (c: CircleCandidate) => void;
  t: Translate;
}) {
  const [candidates, setCandidates] = useState<CircleCandidate[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    routeQuestion(text)
      .then((cs) => {
        if (!alive) return;
        setCandidates(cs);
        // The agent only names a circle when the user did; otherwise take the
        // top-ranked one as the default.
        onSelect(cs.find((c) => c.circleId === preset) ?? cs[0] ?? null!);
      })
      .catch(() => alive && setCandidates([]));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, preset]);

  if (candidates === null) {
    return (
      <p className="mt-2 flex items-center gap-1.5 text-[11.5px] text-[var(--color-faint)]">
        <Loader2 size={12} className="animate-spin" /> {t("forumRoute.finding")}
      </p>
    );
  }
  if (candidates.length === 0) {
    return <p className="mt-2 text-[11.5px] text-rose-300">{t("forumRoute.none")}</p>;
  }

  const others = candidates.filter((c) => c.circleId !== selected?.circleId);

  return (
    <div className="mt-2 rounded-xl border border-line bg-[var(--color-surface)] p-2.5">
      <div className="text-[10.5px] uppercase tracking-wider text-[var(--color-faint)]">
        {t("forumRoute.goesTo")}
      </div>
      <div className="mt-1 flex items-center gap-2">
        <MessagesSquare size={14} style={{ color: "var(--color-accent)" }} />
        <span dir="auto" className="min-w-0 flex-1 truncate text-[13px] font-bold text-ink">
          {selected?.label}
        </span>
        {others.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="shrink-0 text-[11.5px] font-semibold underline decoration-dotted underline-offset-4"
            style={{ color: "var(--color-accent)" }}
          >
            {t("forumRoute.change")}
          </button>
        )}
      </div>
      {selected && <RouteReasons candidate={selected} t={t} />}

      {open && (
        <ul className="mt-2 space-y-1 border-t border-line pt-2">
          {others.map((c) => (
            <li key={c.circleId}>
              <button
                type="button"
                onClick={() => {
                  onSelect(c);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start transition hover:bg-[var(--color-tint)]"
              >
                <span dir="auto" className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{c.label}</span>
                <span className="shrink-0 text-[10.5px] text-[var(--color-faint)]">
                  {t("forumRoute.questionCount", { count: c.postCount })}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Why this circle — the evidence behind the ranking, in the user's language. */
function RouteReasons({ candidate, t }: { candidate: CircleCandidate; t: Translate }) {
  const parts = candidate.reasons
    .slice(0, 3)
    .map((r) =>
      r.kind === "tag" || r.kind === "usedTag"
        ? t("forumRoute.becauseTag", { tag: String(r.value) })
        : r.kind === "name"
          ? t("forumRoute.becauseName")
          : r.kind === "topic"
            ? t("forumRoute.becauseTopic", { topic: String(r.value).replace(/_/g, " ") })
            : t("forumRoute.becauseDescription"),
    );
  if (parts.length === 0) {
    return (
      <p className="mt-1 text-[10.5px] text-[var(--color-faint)]">
        {t("forumRoute.becauseBusiest", { count: candidate.postCount })}
      </p>
    );
  }
  return (
    <p dir="auto" className="mt-1 text-[10.5px] leading-snug text-[var(--color-faint)]">
      {parts.join(" · ")}
    </p>
  );
}
