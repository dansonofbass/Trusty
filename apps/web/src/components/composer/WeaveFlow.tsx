"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Compass,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type { SourceMode } from "@/lib/dataSource";
import type { ExtractStreamEvent } from "@/lib/extractClient";
import type { TrustAssertion } from "@/lib/trustClient";
import {
  reasonsForTopic,
  TOPIC_TAXONOMY,
  type ExtractedEntity,
  type ThoughtExtraction,
} from "@constellation/graph-core";
import { NODE_COLOR, TRUST_ACCENT } from "@/lib/palette";
import { saveDraft } from "@/lib/writings";
import AnnotatedText from "../AnnotatedText";

/**
 * WeaveFlow (#29/#31) — the Write view's extract → review → trust-confirm →
 * weave pipeline, ported into the Composer as an inline flow (the standalone
 * ThoughtComposer/write view is gone). Runs the streaming extraction on mount
 * (or takes a precomputed extraction from the agent's extract_entities tool),
 * lets the user CRUD entities/relations and confirm AI-suggested trust edges,
 * then weaves a thought + concepts into the graph.
 */

const ENTITY_KINDS: ExtractedEntity["kind"][] = [
  "concept", "person", "book", "movie", "music",
  "location", "organization", "technology", "event", "work",
];

const kindColor = (k: ExtractedEntity["kind"]): string => {
  const map: Partial<Record<ExtractedEntity["kind"], string>> = {
    person: NODE_COLOR.person,
    book: NODE_COLOR.book,
    movie: NODE_COLOR.movie,
    music: NODE_COLOR.music,
    location: NODE_COLOR.location,
  };
  return map[k] ?? NODE_COLOR.concept;
};

type Phase = "extracting" | "review" | "weaving" | "complete";

/** Entity names surfacing in the model's PARTIAL JSON stream (never half-typed). */
const STREAM_NAME_RE = /"(?:name|extraction_text|entity)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
function parseLiveNames(raw: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  STREAM_NAME_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = STREAM_NAME_RE.exec(raw))) {
    const name = m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\").trim();
    const key = name.toLowerCase();
    if (name && name.length <= 60 && !seen.has(key)) {
      seen.add(key);
      out.push(name);
    }
  }
  return out;
}

const PHASE_COPY: Record<string, string> = {
  prepare: "Reading your words",
  llm: "Thinking — drawing out the ideas",
  parse: "Naming the entities & relations",
  sources: "Linking ideas to Wikipedia",
  trust: "Spotting who you trust",
  done: "Weaving it together",
};

export default function WeaveFlow({
  text,
  mode,
  pending,
  precomputed,
  onExtract,
  onWeave,
  onExplore,
  onClose,
}: {
  text: string;
  mode: SourceMode;
  pending: boolean;
  /** Skip extraction — e.g. the agent's extract_entities tool already ran. */
  precomputed?: ThoughtExtraction;
  onExtract: (
    text: string,
    onEvent: (ev: ExtractStreamEvent) => void,
  ) => Promise<ThoughtExtraction | null>;
  onWeave: (
    text: string,
    extraction: ThoughtExtraction,
    originalExtraction?: ThoughtExtraction,
    writingId?: string,
    trustAssertions?: TrustAssertion[],
  ) => Promise<{ entityCount: number; conceptIds: string[]; thoughtId: string } | null>;
  onExplore: (thoughtId: string) => void;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>(precomputed ? "review" : "extracting");
  const [progress, setProgress] = useState(precomputed ? 94 : 4);
  const [phaseLabel, setPhaseLabel] = useState("Starting…");
  const [llmOut, setLlmOut] = useState("");
  const [showLlm, setShowLlm] = useState(false);
  const [activity, setActivity] = useState<{ id: string; text: string; tone: "step" | "ok" | "miss" | "done" }[]>([]);
  const lastPhaseRef = useRef<string>("");
  const [liveEntities, setLiveEntities] = useState<string[]>([]);
  const rawRef = useRef("");
  const [extraction, setExtraction] = useState<ThoughtExtraction | null>(precomputed ?? null);
  const [via, setVia] = useState("");
  const [activeEntity, setActiveEntity] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ entityCount: number; conceptIds: string[]; thoughtId: string } | null>(null);
  const [trustSuggestions, setTrustSuggestions] = useState<(TrustAssertion & { include: boolean })[]>([]);
  const llmRef = useRef<HTMLPreElement | null>(null);
  const extractionRef = useRef<ThoughtExtraction | null>(precomputed ?? null);
  const aiExtractionRef = useRef<ThoughtExtraction | null>(precomputed ?? null);
  const writingIdRef = useRef<string>(`wr_${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`);
  const startedRef = useRef(false);

  const liveEntityObjs = useMemo<ExtractedEntity[]>(
    () => liveEntities.map((name) => ({ name, kind: "concept" })),
    [liveEntities],
  );
  const shownEntities: ExtractedEntity[] = extraction?.entities ?? liveEntityObjs;

  const pushAct = (t: string, tone: "step" | "ok" | "miss" | "done") =>
    setActivity((prev) => [...prev, { id: `${prev.length}:${t}`, text: t, tone }]);

  const handleEvent = (ev: ExtractStreamEvent) => {
    if (ev.type === "phase") {
      setPhaseLabel(PHASE_COPY[ev.phase] ?? ev.label);
      setProgress(ev.progress);
      if (ev.phase !== lastPhaseRef.current && PHASE_COPY[ev.phase]) {
        lastPhaseRef.current = ev.phase;
        pushAct(PHASE_COPY[ev.phase], "step");
      }
    } else if (ev.type === "token") {
      rawRef.current += ev.content;
      setLlmOut(rawRef.current);
      const names = parseLiveNames(rawRef.current);
      setLiveEntities((prev) => (names.length !== prev.length ? names : prev));
      queueMicrotask(() => {
        if (llmRef.current) llmRef.current.scrollTop = llmRef.current.scrollHeight;
      });
    } else if (ev.type === "source") {
      pushAct(ev.resolved ? `Linked “${ev.entity}”` : `No source for “${ev.entity}”`, ev.resolved ? "ok" : "miss");
    } else if (ev.type === "trust") {
      if (ev.assertions.length) {
        pushAct(`Spotted ${ev.assertions.length} trust suggestion${ev.assertions.length === 1 ? "" : "s"}`, "done");
        setTrustSuggestions(ev.assertions.map((a) => ({ ...a, include: false })));
      }
    } else if (ev.type === "done") {
      if (ev.trustAssertions?.length) {
        setTrustSuggestions((prev) =>
          prev.length ? prev : ev.trustAssertions!.map((a) => ({ ...a, include: false })),
        );
      }
      pushAct(
        `Found ${ev.extraction.entities.length} idea${ev.extraction.entities.length === 1 ? "" : "s"} · ${ev.extraction.relations.length} link${ev.extraction.relations.length === 1 ? "" : "s"}`,
        "done",
      );
      setExtraction(ev.extraction);
      extractionRef.current = ev.extraction;
      aiExtractionRef.current = ev.extraction;
      setVia(ev.via);
      setPhase("review");
      setProgress(94);
    }
  };

  // Auto-run extraction on mount (unless the agent already extracted).
  useEffect(() => {
    if (startedRef.current || precomputed) return;
    startedRef.current = true;
    void (async () => {
      try {
        const ext = await onExtract(text, handleEvent);
        if (!ext) {
          setErr("Extraction failed — see the notice, or try mock mode.");
          return;
        }
        extractionRef.current = ext;
        setExtraction(ext);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Draft autosave during review — the row flips draft → woven on weave (#31).
  useEffect(() => {
    if (phase !== "review" || !extraction) return;
    const id = writingIdRef.current;
    const ext = extraction;
    const t = setTimeout(() => {
      void saveDraft({ id, title: ext.title ?? text.slice(0, 80), body: text, extraction: ext });
    }, 900);
    return () => clearTimeout(t);
  }, [extraction, phase, text]);

  const runWeave = async () => {
    const ext = extractionRef.current;
    if (!ext || phase === "weaving" || phase === "complete") return;
    setPhase("weaving");
    setProgress(96);
    setPhaseLabel("Weaving into your sky…");
    try {
      const accepted = trustSuggestions.filter((t) => t.include).map(({ include: _include, ...a }) => a);
      const r = await onWeave(text, ext, aiExtractionRef.current ?? undefined, writingIdRef.current, accepted);
      if (r) {
        setSummary(r);
        setPhase("complete");
        setProgress(100);
      } else {
        setErr("Could not weave into the graph.");
        setPhase("review");
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setPhase("review");
    }
  };

  /* --- extraction editing (ported verbatim from the Write view) --- */
  const patchExtraction = (next: ThoughtExtraction) => {
    setExtraction(next);
    extractionRef.current = next;
  };
  const editEntity = (i: number, patch: Partial<ExtractedEntity>) => {
    if (!extraction) return;
    const old = extraction.entities[i];
    const entities = extraction.entities.map((e, j) => (j === i ? { ...e, ...patch } : e));
    let relations = extraction.relations;
    if (patch.name && patch.name !== old.name) {
      relations = relations.map((r) => ({
        ...r,
        source: r.source === old.name ? patch.name! : r.source,
        target: r.target === old.name ? patch.name! : r.target,
      }));
    }
    patchExtraction({ ...extraction, entities, relations });
  };
  const removeEntity = (i: number) => {
    if (!extraction) return;
    const removed = extraction.entities[i];
    patchExtraction({
      ...extraction,
      entities: extraction.entities.filter((_, j) => j !== i),
      relations: extraction.relations.filter((r) => r.source !== removed.name && r.target !== removed.name),
    });
  };
  const editRelation = (i: number, patch: Partial<{ source: string; target: string; label: string }>) => {
    if (!extraction) return;
    patchExtraction({
      ...extraction,
      relations: extraction.relations.map((r, j) => (j === i ? { ...r, ...patch } : r)),
    });
  };
  const removeRelation = (i: number) => {
    if (!extraction) return;
    patchExtraction({ ...extraction, relations: extraction.relations.filter((_, j) => j !== i) });
  };
  const addRelation = () => {
    if (!extraction || extraction.entities.length < 2) return;
    const [a, b] = extraction.entities;
    patchExtraction({
      ...extraction,
      relations: [...extraction.relations, { source: a.name, target: b.name, label: "relates to" }],
    });
  };

  /* --- trust suggestion editing --- */
  const patchTrust = (i: number, patch: Partial<TrustAssertion & { include: boolean }>) =>
    setTrustSuggestions((prev) => prev.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  const patchTrustScope = (i: number, patch: Partial<TrustAssertion["scope"]>) =>
    setTrustSuggestions((prev) => prev.map((t, j) => (j === i ? { ...t, scope: { ...t.scope, ...patch } } : t)));
  const toggleTrustReason = (i: number, code: string) =>
    setTrustSuggestions((prev) =>
      prev.map((t, j) =>
        j === i
          ? { ...t, reasons: t.reasons.includes(code) ? t.reasons.filter((r) => r !== code) : [...t.reasons, code] }
          : t,
      ),
    );

  const working = phase === "extracting" || phase === "weaving" || pending;

  return (
    <div className="rounded-xl border border-[rgba(154,240,200,0.25)] bg-[rgba(154,240,200,0.03)] p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[12px] font-bold text-[#9af0c8]">
          <Sparkles size={13} /> Weave into your sky
          <span className="font-normal text-[10px] text-[var(--color-faint)]">
            {mode === "api" ? via ? `· ${via}` : "" : "· heuristic (offline)"}
          </span>
        </span>
        <button type="button" onClick={onClose} aria-label="Close weave" className="text-[var(--color-faint)] hover:text-ink">
          <X size={14} />
        </button>
      </div>

      {(phase === "extracting" || phase === "weaving") && (
        <div className="mb-2 rounded-lg border border-[rgba(154,240,200,0.2)] bg-[rgba(154,240,200,0.05)] px-3 py-2.5">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-[11.5px] text-ink">
              <Loader2 size={12} className="animate-spin text-[#9af0c8]" /> {phaseLabel}
            </span>
            <span className="text-[10px] text-[var(--color-faint)]" style={{ fontFamily: "var(--font-mono)" }}>
              {progress}%
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-[rgba(146,166,255,0.12)]">
            <div
              className="h-full rounded-full transition-all duration-500 ease-out"
              style={{ width: `${progress}%`, background: "linear-gradient(90deg, #9af0c8, #7c96ff)" }}
            />
          </div>
        </div>
      )}

      {phase === "extracting" && liveEntities.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {liveEntities.map((n, i) => (
            <span key={n} className="chip review-block-in" style={{ animationDelay: `${Math.min(i, 10) * 35}ms` }}>
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "#ff8c5a" }} />
              {n}
            </span>
          ))}
        </div>
      )}

      {activity.length > 0 && phase === "extracting" && (
        <div className="mb-2 rounded-lg border border-[var(--color-line)] bg-[rgba(8,12,28,0.4)] px-3 py-2">
          <ul className="flex flex-col gap-1.5">
            {activity.map((a, i) => {
              const active = i === activity.length - 1;
              return (
                <li key={a.id} className="review-block-in flex items-center gap-2 text-[11.5px]">
                  <span className="grid w-4 shrink-0 place-items-center">
                    {a.tone === "done" ? (
                      <span style={{ color: "#ff8c5a" }}>✦</span>
                    ) : a.tone === "ok" ? (
                      <Check size={12} className="text-[#54d26e]" />
                    ) : a.tone === "miss" ? (
                      <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-faint)]" />
                    ) : active ? (
                      <span className="h-2 w-2 animate-pulse rounded-full bg-[#9af0c8]" />
                    ) : (
                      <Check size={12} className="text-[#9af0c8]" style={{ opacity: 0.5 }} />
                    )}
                  </span>
                  <span className={a.tone === "miss" ? "text-[var(--color-faint)]" : a.tone === "done" ? "font-medium text-ink" : "text-[var(--color-dim)]"}>
                    {a.text}
                  </span>
                </li>
              );
            })}
          </ul>
          {llmOut && (
            <div className="mt-2 border-t border-[var(--color-line)] pt-1.5">
              <button
                type="button"
                className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-[var(--color-faint)] hover:text-ink"
                onClick={() => setShowLlm((v) => !v)}
              >
                {showLlm ? <ChevronUp size={12} /> : <ChevronDown size={12} />} raw model output
              </button>
              {showLlm && (
                <pre
                  ref={llmRef}
                  className="scroll-quiet mt-1 max-h-[100px] overflow-auto text-[10px] leading-relaxed text-[var(--color-faint)]"
                  style={{ fontFamily: "var(--font-mono)" }}
                >
                  {llmOut}
                </pre>
              )}
            </div>
          )}
        </div>
      )}

      {(phase === "review" || phase === "weaving") && extraction && (
        <div className="space-y-3">
          <section className="rounded-lg border border-[rgba(255,140,90,0.22)] bg-[rgba(255,140,90,0.04)] p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-[11.5px] font-semibold text-ink">Your text · entities highlighted</h3>
              <span className="text-[10px] text-[var(--color-faint)]">{extraction.entities.length} found</span>
            </div>
            <AnnotatedText
              text={text}
              entities={extraction.entities}
              activeIndex={activeEntity}
              onHoverEntity={setActiveEntity}
              animate
            />
          </section>

          <section>
            <div className="mb-1.5 flex items-center justify-between">
              <h3 className="text-[11.5px] font-semibold text-ink">Entities · {extraction.entities.length}</h3>
              <span className="text-[9.5px] text-[var(--color-faint)]">rename, retype, remove</span>
            </div>
            <ul className="flex flex-col gap-1.5">
              {extraction.entities.map((e, i) => (
                <li
                  key={i}
                  className="flex items-center gap-2 rounded-lg border border-[var(--color-line)] bg-[rgba(146,166,255,0.04)] p-1.5"
                  onMouseEnter={() => setActiveEntity(i)}
                  onMouseLeave={() => setActiveEntity(null)}
                >
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: kindColor(e.kind) }} />
                  <input
                    value={e.name}
                    onChange={(ev) => editEntity(i, { name: ev.target.value })}
                    className="min-w-0 flex-1 bg-transparent text-[12px] text-ink outline-none"
                  />
                  <select
                    value={e.kind}
                    onChange={(ev) => editEntity(i, { kind: ev.target.value as ExtractedEntity["kind"] })}
                    className="rounded bg-[rgba(146,166,255,0.08)] px-1 py-0.5 text-[10px] text-[var(--color-dim)] outline-none"
                  >
                    {ENTITY_KINDS.map((k) => (
                      <option key={k} value={k}>{k}</option>
                    ))}
                  </select>
                  <button type="button" aria-label="Remove entity" className="rounded p-1 text-[var(--color-faint)] hover:text-[#ff9a90]" onClick={() => removeEntity(i)}>
                    <Trash2 size={12} />
                  </button>
                </li>
              ))}
              {extraction.entities.length === 0 && (
                <li className="text-[10.5px] text-[var(--color-faint)]">No entities — nothing to weave.</li>
              )}
            </ul>
          </section>

          <section>
            <div className="mb-1.5 flex items-center justify-between">
              <h3 className="text-[11.5px] font-semibold text-ink">Connections · {extraction.relations.length}</h3>
              <button type="button" className="btn" disabled={extraction.entities.length < 2} onClick={addRelation}>
                <Plus size={11} /> Add
              </button>
            </div>
            <ul className="flex flex-col gap-1.5">
              {extraction.relations.map((r, i) => (
                <li key={i} className="flex items-center gap-1.5 rounded-lg border border-[var(--color-line)] bg-[rgba(146,166,255,0.04)] p-1.5 text-[11px]">
                  <select
                    value={r.source}
                    onChange={(ev) => editRelation(i, { source: ev.target.value })}
                    className="min-w-0 flex-1 rounded bg-[rgba(146,166,255,0.08)] px-1 py-0.5 text-ink outline-none"
                  >
                    {extraction.entities.map((e) => (
                      <option key={e.name} value={e.name}>{e.name}</option>
                    ))}
                  </select>
                  <input
                    value={r.label ?? ""}
                    onChange={(ev) => editRelation(i, { label: ev.target.value })}
                    placeholder="relates to"
                    className="w-20 shrink-0 bg-transparent text-center text-[10px] text-[var(--color-dim)] outline-none"
                  />
                  <select
                    value={r.target}
                    onChange={(ev) => editRelation(i, { target: ev.target.value })}
                    className="min-w-0 flex-1 rounded bg-[rgba(146,166,255,0.08)] px-1 py-0.5 text-ink outline-none"
                  >
                    {extraction.entities.map((e) => (
                      <option key={e.name} value={e.name}>{e.name}</option>
                    ))}
                  </select>
                  <button type="button" aria-label="Remove connection" className="rounded p-1 text-[var(--color-faint)] hover:text-[#ff9a90]" onClick={() => removeRelation(i)}>
                    <Trash2 size={12} />
                  </button>
                </li>
              ))}
              {extraction.relations.length === 0 && (
                <li className="text-[10.5px] text-[var(--color-faint)]">No connections — add one to link two ideas.</li>
              )}
            </ul>
          </section>

          {trustSuggestions.length > 0 && (
            <section>
              <div className="mb-1.5 flex items-center justify-between">
                <h3 className="text-[11.5px] font-semibold" style={{ color: TRUST_ACCENT }}>
                  ✦ Trust suggestions · {trustSuggestions.length}
                </h3>
                <span className="text-[9.5px] text-[var(--color-faint)]">confirm to add — off by default</span>
              </div>
              <ul className="flex flex-col gap-2">
                {trustSuggestions.map((t, i) => (
                  <li
                    key={i}
                    className="rounded-lg border p-2"
                    style={{
                      borderColor: t.include ? "rgba(255,140,90,0.5)" : "var(--color-line)",
                      background: t.include ? "rgba(255,140,90,0.06)" : "rgba(146,166,255,0.04)",
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={t.include}
                        onChange={(e) => patchTrust(i, { include: e.target.checked })}
                        style={{ accentColor: TRUST_ACCENT }}
                      />
                      <span className="text-[10.5px] text-[var(--color-dim)]">You trust</span>
                      <input
                        value={t.object}
                        onChange={(e) => patchTrust(i, { object: e.target.value })}
                        className="min-w-0 flex-1 bg-transparent text-[12px] font-medium text-ink outline-none"
                      />
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-6">
                      <select
                        value={t.scope.topic}
                        onChange={(e) => patchTrustScope(i, { topic: e.target.value })}
                        className="rounded bg-[rgba(146,166,255,0.08)] px-1 py-0.5 text-[10px] text-[var(--color-dim)] outline-none"
                      >
                        {[t.scope.topic, ...TOPIC_TAXONOMY.filter((x) => x !== t.scope.topic)].filter(Boolean).map((x) => (
                          <option key={x} value={x}>{x.replace(/_/g, " ")}</option>
                        ))}
                      </select>
                      <input
                        value={t.scope.geo ?? ""}
                        onChange={(e) => patchTrustScope(i, { geo: e.target.value || undefined })}
                        placeholder="anywhere"
                        className="w-20 rounded bg-[rgba(146,166,255,0.08)] px-1 py-0.5 text-[10px] text-ink outline-none"
                      />
                      <span className="text-[9.5px] text-[var(--color-faint)]">conf {t.confidence.toFixed(2)}</span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1 pl-6">
                      {reasonsForTopic(t.scope.topic).slice(0, 8).map((rc) => (
                        <button
                          key={rc}
                          type="button"
                          onClick={() => toggleTrustReason(i, rc)}
                          className="rounded-full border px-1.5 py-0.5 text-[9.5px]"
                          style={{
                            borderColor: t.reasons.includes(rc) ? "rgba(255,140,90,0.6)" : "var(--color-line)",
                            color: t.reasons.includes(rc) ? "var(--color-ink)" : "var(--color-faint)",
                          }}
                        >
                          {rc.replace(/_/g, " ")}
                        </button>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <button
            type="button"
            className="btn btn-gold w-full justify-center"
            disabled={working || !extraction.entities.length}
            onClick={() => void runWeave()}
          >
            <Sparkles size={13} /> Accept &amp; weave in
          </button>
        </div>
      )}

      {err && (
        <p className="mt-2 rounded-lg border border-[rgba(255,97,87,0.3)] bg-[rgba(255,97,87,0.08)] px-3 py-2 text-[11.5px] text-[#ff9a90]">
          {err}
        </p>
      )}

      {phase === "complete" && summary && (
        <div className="review-block-in rounded-lg border border-[rgba(154,240,200,0.3)] bg-[rgba(154,240,200,0.08)] px-3 py-2.5">
          <p className="text-[12px] leading-relaxed text-ink">
            ✦ <b>{summary.entityCount}</b> {summary.entityCount === 1 ? "entity" : "entities"} now live in your sky
            {summary.conceptIds.length ? ` · ${summary.conceptIds.length} new concept${summary.conceptIds.length === 1 ? "" : "s"}` : ""}.
          </p>
          <div className="mt-2 flex gap-2">
            <button className="btn btn-gold" onClick={() => onExplore(summary.thoughtId)}>
              <Compass size={12} /> Explore in sky
            </button>
            <button className="btn" onClick={onClose}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}
