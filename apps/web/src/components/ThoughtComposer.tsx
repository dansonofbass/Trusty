"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Brain,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
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
import {
  fetchWriting,
  fetchWritings,
  saveDraft,
  type WritingDetail,
  type WritingEvent,
  type WritingSummary,
} from "@/lib/writings";
import AnnotatedText from "./AnnotatedText";

/** Human one-liner for a writing's log entry. */
function describeEvent(e: WritingEvent): string {
  const d = (e.detail ?? {}) as { entities?: number; added?: string[]; removed?: string[] };
  switch (e.kind) {
    case "extracted":
      return `AI extracted ${d.entities ?? 0} ideas`;
    case "edited":
      return `You edited — ${d.added?.length ?? 0} added, ${d.removed?.length ?? 0} removed`;
    case "woven":
      return `Woven into your sky (${d.entities ?? 0} entities)`;
    default:
      return e.kind;
  }
}

const ENTITY_KINDS: ExtractedEntity["kind"][] = [
  "concept",
  "person",
  "book",
  "movie",
  "music",
  "location",
  "organization",
  "technology",
  "event",
  "work",
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

const SAMPLES: { label: string; text: string }[] = [
  {
    label: "On attention & focus",
    text: "I keep returning to the idea that attention is the real currency of our age. We talk about information overload, but the scarce resource was never information — it was sustained attention. Deep work, in Cal Newport's sense, is becoming a competitive advantage precisely because it is rare. The transformer architecture that powers modern language models is, ironically, an attention mechanism too: it learned to weight what matters. Maybe the same discipline that makes a model good — deciding what to attend to — is what makes a mind good.",
  },
  {
    label: "فرهنگ و حافظه",
    text: "هر بار که بوف کور صادق هدایت را می‌خوانم، به رابطهٔ میان حافظه و هویت فکر می‌کنم. شهر تهران در ذهن من با موسیقی و خاطره گره خورده است. آیا فرهنگ چیزی جز حافظهٔ جمعی است؟",
  },
  {
    label: "Markets & narrative",
    text: "Markets don't run on fundamentals alone; they run on narrative. A stock like a meme is a story people tell each other until they stop. The 2021 retail surge wasn't irrational — it was a coordination game played on social networks, where the payoff depended on belief in others' belief. Soros called this reflexivity: perception shapes the fundamentals it claims merely to observe.",
  },
];

type Phase = "idle" | "extracting" | "review" | "weaving" | "complete";

/**
 * Pull entity names out of the model's PARTIAL JSON stream as they complete, so
 * we can show ideas surfacing live. Tolerant of provider shape: Claude emits
 * `"name": "..."`, the LangExtract/Ollama path emits `"extraction_text": "..."`.
 * A value only matches once its closing quote has streamed in, so we never show
 * half-typed names.
 */
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

/** Relations between extracted entities — "X — label → Y". */
function Relations({
  relations,
}: {
  relations: { source: string; target: string; label?: string }[];
}) {
  if (!relations.length) return null;
  return (
    <section>
      <h3 className="mb-2 text-[12px] font-semibold text-ink">
        Connections found · {relations.length}
      </h3>
      <ul className="flex flex-col gap-1.5">
        {relations.map((r, i) => (
          <li key={i} className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
            <span className="font-medium text-ink">{r.source}</span>
            <span className="text-[var(--color-faint)]">{r.label ? `— ${r.label} →` : "→"}</span>
            <span className="font-medium text-ink">{r.target}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function ThoughtComposer({
  mode,
  pending,
  onExtract,
  onWeave,
  onExplore,
  onClose,
}: {
  mode: SourceMode;
  pending: boolean;
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
  // History + the currently-viewed writing come from the Postgres log (BFF).
  const [history, setHistory] = useState<WritingSummary[]>([]);
  const [viewing, setViewing] = useState<WritingDetail | null>(null);
  const refreshHistory = () => {
    void fetchWritings().then(setHistory);
  };
  useEffect(() => {
    refreshHistory();
  }, []);
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [phaseLabel, setPhaseLabel] = useState("");
  const [llmOut, setLlmOut] = useState("");
  const [showLlm, setShowLlm] = useState(false);
  // Parsed "what the AI is doing" feed — replaces raw token logs.
  const [activity, setActivity] = useState<
    { id: string; text: string; tone: "step" | "ok" | "miss" | "done" }[]
  >([]);
  const lastPhaseRef = useRef<string>("");
  // Entities spotted in the partial stream, shown live as they complete.
  const [liveEntities, setLiveEntities] = useState<string[]>([]);
  const rawRef = useRef("");
  const [extraction, setExtraction] = useState<ThoughtExtraction | null>(null);
  const [via, setVia] = useState("");
  const [activeEntity, setActiveEntity] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [summary, setSummary] = useState<{
    entityCount: number;
    conceptIds: string[];
    thoughtId: string;
  } | null>(null);
  const [reviewReady, setReviewReady] = useState(false);
  // AI-proposed trust edges — the user must confirm each before it's written (Doc §15).
  const [trustSuggestions, setTrustSuggestions] = useState<(TrustAssertion & { include: boolean })[]>([]);
  const llmRef = useRef<HTMLPreElement | null>(null);
  const weaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const extractionRef = useRef<ThoughtExtraction | null>(null);
  // The model's original extraction (before the user edits) — logged on weave.
  const aiExtractionRef = useRef<ThoughtExtraction | null>(null);
  // Durable writing id for this session (draft → woven keep the same id).
  const writingIdRef = useRef<string | null>(null);

  // Entities still streaming in (names only) → shaped for live highlighting.
  const liveEntityObjs = useMemo<ExtractedEntity[]>(
    () => liveEntities.map((name) => ({ name, kind: "concept" })),
    [liveEntities],
  );
  // What to highlight in the text right now: the full extraction once it lands,
  // otherwise the names surfacing live.
  const shownEntities: ExtractedEntity[] = extraction?.entities ?? liveEntityObjs;

  const clearWeaveTimer = () => {
    if (weaveTimer.current) {
      clearTimeout(weaveTimer.current);
      weaveTimer.current = null;
    }
  };

  useEffect(() => () => clearWeaveTimer(), []);

  // Persist the draft as you review/edit, so it survives a reload before you
  // accept it (debounced; the row flips draft → woven on weave).
  useEffect(() => {
    if (phase !== "review" || !extraction || !writingIdRef.current) return;
    const id = writingIdRef.current;
    const body = text;
    const ext = extraction;
    const t = setTimeout(() => {
      void saveDraft({ id, title: ext.title ?? body.slice(0, 80), body, extraction: ext }).then(
        refreshHistory,
      );
    }, 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extraction, phase, text]);

  const resetRun = () => {
    clearWeaveTimer();
    setPhase("idle");
    setProgress(0);
    setPhaseLabel("");
    setLlmOut("");
    setExtraction(null);
    extractionRef.current = null;
    setVia("");
    setActiveEntity(null);
    setErr(null);
    setSummary(null);
    setReviewReady(false);
    setShowLlm(false);
    setActivity([]);
    lastPhaseRef.current = "";
    setLiveEntities([]);
    rawRef.current = "";
    setTrustSuggestions([]);
  };

  // Friendly, human copy for each extraction phase (instead of raw labels).
  const PHASE_COPY: Record<string, string> = {
    prepare: "Reading your words",
    llm: "Thinking — drawing out the ideas",
    parse: "Naming the entities & relations",
    sources: "Linking ideas to Wikipedia",
    trust: "Spotting who you trust",
    done: "Weaving it together",
  };

  const pushAct = (text: string, tone: "step" | "ok" | "miss" | "done") =>
    setActivity((prev) => [...prev, { id: `${prev.length}:${text}`, text, tone }]);

  const handleEvent = (ev: ExtractStreamEvent) => {
    if (ev.type === "phase") {
      setPhaseLabel(PHASE_COPY[ev.phase] ?? ev.label);
      setProgress(ev.progress);
      // One feed line per distinct phase (not per progress tick).
      if (ev.phase !== lastPhaseRef.current && PHASE_COPY[ev.phase]) {
        lastPhaseRef.current = ev.phase;
        pushAct(PHASE_COPY[ev.phase], "step");
      }
    } else if (ev.type === "token") {
      // Accumulate raw output (kept for the curious) and parse entities live.
      rawRef.current += ev.content;
      setLlmOut(rawRef.current);
      const names = parseLiveNames(rawRef.current);
      setLiveEntities((prev) => (names.length !== prev.length ? names : prev));
      queueMicrotask(() => {
        if (llmRef.current) llmRef.current.scrollTop = llmRef.current.scrollHeight;
      });
    } else if (ev.type === "source") {
      pushAct(
        ev.resolved ? `Linked “${ev.entity}”` : `No source for “${ev.entity}”`,
        ev.resolved ? "ok" : "miss",
      );
    } else if (ev.type === "trust") {
      if (ev.assertions.length) {
        pushAct(
          `Spotted ${ev.assertions.length} trust suggestion${ev.assertions.length === 1 ? "" : "s"}`,
          "done",
        );
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
      aiExtractionRef.current = ev.extraction; // snapshot before edits
      setVia(ev.via);
      setPhase("review");
      setProgress(94);
      setReviewReady(false);
      setTimeout(() => setReviewReady(true), 80);
    }
  };

  const runWeave = async () => {
    const ext = extractionRef.current;
    if (!ext || phase === "weaving" || phase === "complete") return;
    clearWeaveTimer();
    setPhase("weaving");
    setProgress(96);
    setPhaseLabel("Weaving into your sky…");
    try {
      const accepted = trustSuggestions
        .filter((t) => t.include)
        .map(({ include, ...a }) => a);
      const r = await onWeave(
        text,
        ext,
        aiExtractionRef.current ?? undefined,
        writingIdRef.current ?? undefined,
        accepted,
      );
      if (r) {
        setSummary(r);
        setPhase("complete");
        setProgress(100);
        setPhaseLabel("Saved to your constellation");
        refreshHistory();
      } else {
        setErr("Could not weave into the graph.");
        setPhase("review");
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setPhase("review");
    }
  };

  const run = async () => {
    if (!text.trim() || phase === "extracting" || phase === "weaving" || pending) return;
    writingIdRef.current = `wr_${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`;
    setPhase("extracting");
    setProgress(4);
    setPhaseLabel("Starting…");
    setLlmOut("");
    setExtraction(null);
    extractionRef.current = null;
    setErr(null);
    setSummary(null);
    setReviewReady(false);
    setShowLlm(false);
    setActivity([]);
    lastPhaseRef.current = "";
    setLiveEntities([]);
    rawRef.current = "";

    try {
      const ext = await onExtract(text, handleEvent);
      if (!ext) {
        setErr("Extraction failed — see the notice, or try mock mode.");
        resetRun();
        return;
      }
      extractionRef.current = ext;
      setExtraction(ext);
      // No auto-weave — the user reviews/edits entities & relations, then accepts.
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      resetRun();
    }
  };

  /* --- editing the extraction before accepting it into the graph --- */
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
      relations: extraction.relations.filter(
        (r) => r.source !== removed.name && r.target !== removed.name,
      ),
    });
  };
  const editRelation = (
    i: number,
    patch: Partial<{ source: string; target: string; label: string }>,
  ) => {
    if (!extraction) return;
    patchExtraction({
      ...extraction,
      relations: extraction.relations.map((r, j) => (j === i ? { ...r, ...patch } : r)),
    });
  };
  const removeRelation = (i: number) => {
    if (!extraction) return;
    patchExtraction({
      ...extraction,
      relations: extraction.relations.filter((_, j) => j !== i),
    });
  };
  const addRelation = () => {
    if (!extraction || extraction.entities.length < 2) return;
    const [a, b] = extraction.entities;
    patchExtraction({
      ...extraction,
      relations: [...extraction.relations, { source: a.name, target: b.name, label: "relates to" }],
    });
  };

  /* --- editing the AI-proposed trust suggestions before confirming --- */
  const patchTrust = (i: number, patch: Partial<TrustAssertion & { include: boolean }>) =>
    setTrustSuggestions((prev) => prev.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  const patchTrustScope = (i: number, patch: Partial<TrustAssertion["scope"]>) =>
    setTrustSuggestions((prev) =>
      prev.map((t, j) => (j === i ? { ...t, scope: { ...t.scope, ...patch } } : t)),
    );
  const toggleTrustReason = (i: number, code: string) =>
    setTrustSuggestions((prev) =>
      prev.map((t, j) =>
        j === i
          ? { ...t, reasons: t.reasons.includes(code) ? t.reasons.filter((r) => r !== code) : [...t.reasons, code] }
          : t,
      ),
    );

  // Reopen a saved draft for continued editing (then Accept & weave).
  const resumeDraft = (d: WritingDetail) => {
    const ext = d.extraction ?? { entities: [], relations: [] };
    setViewing(null);
    setText(d.body);
    setExtraction(ext);
    extractionRef.current = ext;
    aiExtractionRef.current = ext;
    writingIdRef.current = d.id;
    setErr(null);
    setSummary(null);
    setVia("");
    setActivity([]);
    setLiveEntities([]);
    setTrustSuggestions([]);
    setReviewReady(true);
    setPhase("review");
  };

  const working = phase === "extracting" || phase === "weaving" || pending;
  const showResults =
    phase === "review" || phase === "weaving" || (phase === "complete" && extraction);

  return (
    <div className="pointer-events-none fixed inset-y-0 right-0 z-20 flex w-full max-w-[440px] p-3">
      <div className="panel pointer-events-auto flex h-full w-full flex-col overflow-hidden">
        <div className="flex shrink-0 items-center gap-2.5 border-b border-[var(--color-line)] px-4 py-3">
          <span
            className="grid h-8 w-8 shrink-0 place-items-center rounded-xl"
            style={{ background: "rgba(154,240,200,0.14)", color: "#9af0c8" }}
          >
            <Brain size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-[14px] font-bold tracking-wide text-ink">
              Think out loud
            </h2>
            <p className="truncate text-[10.5px] text-[var(--color-dim)]">
              {mode === "api"
                ? "Watch ideas surface, then weave them in"
                : "Heuristic (offline) extraction"}
            </p>
          </div>
          {(viewing || phase !== "idle") && (
            <button
              type="button"
              className="btn"
              title="New writing"
              onClick={() => {
                setViewing(null);
                resetRun();
              }}
            >
              <Plus size={13} /> New
            </button>
          )}
          <button
            type="button"
            aria-label="Close"
            className="rounded-lg p-1.5 text-[var(--color-faint)] hover:bg-[rgba(146,166,255,0.1)] hover:text-ink"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>

        <div className="scroll-quiet flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
          {viewing ? (
            <>
              <button
                type="button"
                className="btn self-start"
                onClick={() => setViewing(null)}
              >
                <ArrowLeft size={12} /> Back to history
              </button>
              <h3 className="text-[13.5px] font-semibold text-ink">
                {viewing.title ?? "Untitled"}
              </h3>
              {viewing.extraction?.summary && (
                <p className="text-[11.5px] italic text-[var(--color-dim)]">
                  {viewing.extraction.summary}
                </p>
              )}
              {viewing.body && (
                <section className="rounded-xl border border-[rgba(255,217,122,0.2)] bg-[rgba(255,217,122,0.04)] p-3.5">
                  <AnnotatedText
                    text={viewing.body}
                    entities={viewing.extraction?.entities ?? []}
                    animate
                  />
                </section>
              )}
              <Relations relations={viewing.extraction?.relations ?? []} />
              {viewing.events.length > 0 && (
                <section>
                  <div className="eyebrow mb-2 flex items-center gap-1.5">
                    <Clock size={11} /> Activity log
                  </div>
                  <ul className="flex flex-col gap-1.5">
                    {viewing.events.map((e, i) => (
                      <li
                        key={i}
                        className="flex items-center gap-2 text-[11px] text-[var(--color-dim)]"
                      >
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#9af0c8]" />
                        <span>{describeEvent(e)}</span>
                        <span className="ml-auto shrink-0 text-[10px] text-[var(--color-faint)]">
                          {new Date(e.at).toLocaleString()}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          ) : (
            <>
          {(phase === "extracting" || phase === "weaving") && (
            <div className="rounded-xl border border-[rgba(154,240,200,0.2)] bg-[rgba(154,240,200,0.05)] px-3.5 py-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-[12px] text-ink">
                  <Loader2 size={13} className="animate-spin text-[#9af0c8]" />
                  {phaseLabel}
                </span>
                <span
                  className="text-[10px] text-[var(--color-faint)]"
                  style={{ fontFamily: "var(--font-mono)" }}
                >
                  {progress}%
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-[rgba(146,166,255,0.12)]">
                <div
                  className="h-full rounded-full transition-all duration-500 ease-out"
                  style={{
                    width: `${progress}%`,
                    background: "linear-gradient(90deg, #9af0c8, #7c96ff)",
                  }}
                />
              </div>
            </div>
          )}

          {phase === "extracting" && liveEntities.length > 0 && (
            <div className="rounded-xl border border-[rgba(255,217,122,0.22)] bg-[rgba(255,217,122,0.05)] px-3.5 py-3">
              <div className="eyebrow mb-2 flex items-center gap-1.5" style={{ color: "#ffd97a" }}>
                <Sparkles size={11} /> Ideas surfacing · {liveEntities.length}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {liveEntities.map((n, i) => (
                  <span
                    key={n}
                    className="chip review-block-in"
                    style={{ animationDelay: `${Math.min(i, 10) * 35}ms` }}
                  >
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: "#ffd97a" }}
                    />
                    {n}
                  </span>
                ))}
              </div>
            </div>
          )}

          {phase === "extracting" && shownEntities.length > 0 && text.trim() && (
            <section className="rounded-xl border border-[rgba(255,217,122,0.2)] bg-[rgba(255,217,122,0.04)] p-3.5">
              <div className="eyebrow mb-2 text-[var(--color-faint)]">Where they appear in your text</div>
              <AnnotatedText
                text={text}
                entities={shownEntities}
                activeIndex={activeEntity}
                onHoverEntity={setActiveEntity}
                animate
              />
            </section>
          )}

          {activity.length > 0 && phase !== "complete" && (
            <div className="rounded-xl border border-[var(--color-line)] bg-[rgba(8,12,28,0.4)] px-3.5 py-3">
              <ul className="flex flex-col gap-2">
                {activity.map((a, i) => {
                  const active = i === activity.length - 1 && phase === "extracting";
                  return (
                    <li
                      key={a.id}
                      className="review-block-in flex items-center gap-2.5 text-[12px]"
                    >
                      <span className="grid w-4 shrink-0 place-items-center">
                        {a.tone === "done" ? (
                          <span style={{ color: "#ffd97a" }}>✦</span>
                        ) : a.tone === "ok" ? (
                          <Check size={13} className="text-[#54d26e]" />
                        ) : a.tone === "miss" ? (
                          <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-faint)]" />
                        ) : active ? (
                          <span className="h-2 w-2 animate-pulse rounded-full bg-[#9af0c8]" />
                        ) : (
                          <Check size={13} className="text-[#9af0c8]" style={{ opacity: 0.5 }} />
                        )}
                      </span>
                      <span
                        className={
                          a.tone === "miss"
                            ? "text-[var(--color-faint)]"
                            : a.tone === "done"
                              ? "font-medium text-ink"
                              : "text-[var(--color-dim)]"
                        }
                      >
                        {a.text}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {llmOut && (
                <div className="mt-2.5 border-t border-[var(--color-line)] pt-2">
                  <button
                    type="button"
                    className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-[var(--color-faint)] hover:text-ink"
                    onClick={() => setShowLlm((v) => !v)}
                  >
                    {showLlm ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    raw model output {via ? `· ${via}` : ""}
                  </button>
                  {showLlm && (
                    <pre
                      ref={llmRef}
                      className="scroll-quiet mt-1 max-h-[120px] overflow-auto text-[10.5px] leading-relaxed text-[var(--color-faint)]"
                      style={{ fontFamily: "var(--font-mono)" }}
                    >
                      {llmOut}
                    </pre>
                  )}
                </div>
              )}
            </div>
          )}

          {phase === "idle" && (
            <>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={8}
                placeholder="Paste an article, or write a thought… What are you turning over in your mind?"
                className="scroll-quiet w-full resize-none rounded-xl border border-[var(--color-line)] bg-[rgba(146,166,255,0.05)] p-3.5 text-[13.5px] leading-relaxed text-ink outline-none placeholder:text-[var(--color-faint)] focus:border-[rgba(154,240,200,0.4)]"
              />
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] text-[var(--color-faint)]">Try:</span>
                {SAMPLES.map((s) => (
                  <button
                    key={s.label}
                    className="chip"
                    onClick={() => {
                      setText(s.text);
                      resetRun();
                    }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              {history.length > 0 && (
                <section>
                  <div className="eyebrow mb-2 flex items-center gap-1.5">
                    <Clock size={11} /> Your writings · {history.length}
                  </div>
                  <ul className="flex flex-col gap-1.5">
                    {history.map((t) => (
                      <li key={t.id}>
                        <button
                          type="button"
                          className="w-full rounded-xl border border-[var(--color-line)] bg-[rgba(146,166,255,0.04)] p-2.5 text-left transition hover:border-[rgba(146,166,255,0.3)]"
                          onClick={() =>
                            void fetchWriting(t.id).then((d) => {
                              if (!d) return;
                              if (t.status === "draft") resumeDraft(d);
                              else setViewing(d);
                            })
                          }
                        >
                          <div className="flex items-center gap-2">
                            <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink">
                              {t.title ?? "Untitled"}
                            </span>
                            {t.status === "draft" && (
                              <span
                                className="shrink-0 rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wide"
                                style={{ background: "rgba(255,217,122,0.16)", color: "#ffd97a" }}
                              >
                                draft
                              </span>
                            )}
                          </div>
                          {t.summary && (
                            <div className="truncate text-[10.5px] text-[var(--color-faint)]">
                              {t.summary}
                            </div>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}

          {showResults && extraction && reviewReady && (
            <>
              <section
                className="review-block-in rounded-xl border border-[rgba(255,217,122,0.22)] bg-[rgba(255,217,122,0.04)] p-4"
                style={{ animationDelay: "0ms" }}
              >
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="text-[12.5px] font-semibold text-ink">Your text · entities highlighted</h3>
                  <span className="text-[10.5px] text-[var(--color-faint)]">
                    {extraction.entities.length} found
                  </span>
                </div>
                <AnnotatedText
                  text={text}
                  entities={extraction.entities}
                  activeIndex={activeEntity}
                  onHoverEntity={setActiveEntity}
                  animate
                />
              </section>

              <section className="review-block-in" style={{ animationDelay: "180ms" }}>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-[12.5px] font-semibold text-ink">
                    Entities · {extraction.entities.length}
                  </h3>
                  <span className="text-[10px] text-[var(--color-faint)]">
                    rename, retype, or remove before weaving
                  </span>
                </div>
                <ul className="flex flex-col gap-1.5">
                  {extraction.entities.map((e, i) => (
                    <li
                      key={i}
                      className="flex items-center gap-2 rounded-lg border border-[var(--color-line)] bg-[rgba(146,166,255,0.04)] p-1.5"
                      onMouseEnter={() => setActiveEntity(i)}
                      onMouseLeave={() => setActiveEntity(null)}
                    >
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ background: kindColor(e.kind) }}
                      />
                      <input
                        value={e.name}
                        onChange={(ev) => editEntity(i, { name: ev.target.value })}
                        className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none"
                      />
                      <select
                        value={e.kind}
                        onChange={(ev) =>
                          editEntity(i, { kind: ev.target.value as ExtractedEntity["kind"] })
                        }
                        className="rounded bg-[rgba(146,166,255,0.08)] px-1 py-0.5 text-[10.5px] text-[var(--color-dim)] outline-none"
                      >
                        {ENTITY_KINDS.map((k) => (
                          <option key={k} value={k}>
                            {k}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        aria-label="Remove entity"
                        className="rounded p-1 text-[var(--color-faint)] hover:text-[#ff9a90]"
                        onClick={() => removeEntity(i)}
                      >
                        <Trash2 size={12} />
                      </button>
                    </li>
                  ))}
                  {extraction.entities.length === 0 && (
                    <li className="text-[11px] text-[var(--color-faint)]">
                      No entities — nothing to weave.
                    </li>
                  )}
                </ul>
              </section>

              <section className="review-block-in" style={{ animationDelay: "320ms" }}>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-[12.5px] font-semibold text-ink">
                    Connections · {extraction.relations.length}
                  </h3>
                  <button
                    type="button"
                    className="btn"
                    disabled={extraction.entities.length < 2}
                    onClick={addRelation}
                  >
                    <Plus size={11} /> Add
                  </button>
                </div>
                <ul className="flex flex-col gap-1.5">
                  {extraction.relations.map((r, i) => (
                    <li
                      key={i}
                      className="flex items-center gap-1.5 rounded-lg border border-[var(--color-line)] bg-[rgba(146,166,255,0.04)] p-1.5 text-[11px]"
                    >
                      <select
                        value={r.source}
                        onChange={(ev) => editRelation(i, { source: ev.target.value })}
                        className="min-w-0 flex-1 rounded bg-[rgba(146,166,255,0.08)] px-1 py-0.5 text-ink outline-none"
                      >
                        {extraction.entities.map((e) => (
                          <option key={e.name} value={e.name}>
                            {e.name}
                          </option>
                        ))}
                      </select>
                      <input
                        value={r.label ?? ""}
                        onChange={(ev) => editRelation(i, { label: ev.target.value })}
                        placeholder="relates to"
                        className="w-24 shrink-0 bg-transparent text-center text-[10.5px] text-[var(--color-dim)] outline-none"
                      />
                      <select
                        value={r.target}
                        onChange={(ev) => editRelation(i, { target: ev.target.value })}
                        className="min-w-0 flex-1 rounded bg-[rgba(146,166,255,0.08)] px-1 py-0.5 text-ink outline-none"
                      >
                        {extraction.entities.map((e) => (
                          <option key={e.name} value={e.name}>
                            {e.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        aria-label="Remove connection"
                        className="rounded p-1 text-[var(--color-faint)] hover:text-[#ff9a90]"
                        onClick={() => removeRelation(i)}
                      >
                        <Trash2 size={12} />
                      </button>
                    </li>
                  ))}
                  {extraction.relations.length === 0 && (
                    <li className="text-[11px] text-[var(--color-faint)]">
                      No connections — add one to link two ideas.
                    </li>
                  )}
                </ul>
              </section>

              {trustSuggestions.length > 0 && (
                <section className="review-block-in" style={{ animationDelay: "440ms" }}>
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-[12.5px] font-semibold" style={{ color: TRUST_ACCENT }}>
                      ✦ Trust suggestions · {trustSuggestions.length}
                    </h3>
                    <span className="text-[10px] text-[var(--color-faint)]">confirm to add — off by default</span>
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
                          <span className="text-[11px] text-[var(--color-dim)]">You trust</span>
                          <input
                            value={t.object}
                            onChange={(e) => patchTrust(i, { object: e.target.value })}
                            className="min-w-0 flex-1 bg-transparent text-[12.5px] font-medium text-ink outline-none"
                          />
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-6">
                          <select
                            value={t.scope.topic}
                            onChange={(e) => patchTrustScope(i, { topic: e.target.value })}
                            className="rounded bg-[rgba(146,166,255,0.08)] px-1 py-0.5 text-[10.5px] text-[var(--color-dim)] outline-none"
                          >
                            {[t.scope.topic, ...TOPIC_TAXONOMY.filter((x) => x !== t.scope.topic)]
                              .filter(Boolean)
                              .map((x) => (
                                <option key={x} value={x}>{x.replace(/_/g, " ")}</option>
                              ))}
                          </select>
                          <input
                            value={t.scope.geo ?? ""}
                            onChange={(e) => patchTrustScope(i, { geo: e.target.value || undefined })}
                            placeholder="anywhere"
                            className="w-24 rounded bg-[rgba(146,166,255,0.08)] px-1 py-0.5 text-[10.5px] text-ink outline-none"
                          />
                          <span className="text-[10px] text-[var(--color-faint)]">conf {t.confidence.toFixed(2)}</span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-1 pl-6">
                          {reasonsForTopic(t.scope.topic).slice(0, 8).map((rc) => (
                            <button
                              key={rc}
                              type="button"
                              onClick={() => toggleTrustReason(i, rc)}
                              className="rounded-full border px-1.5 py-0.5 text-[10px]"
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
            </>
          )}

          {phase === "review" && extraction && (
            <p className="text-center text-[11px] text-[var(--color-faint)]">
              Edit the entities and connections above, then weave them into your sky.
            </p>
          )}

          {err && (
            <p className="rounded-lg border border-[rgba(255,97,87,0.3)] bg-[rgba(255,97,87,0.08)] px-3 py-2 text-[12px] text-[#ff9a90]">
              {err}
            </p>
          )}

          {phase === "complete" && summary && (
            <div
              className="review-block-in rounded-xl border border-[rgba(154,240,200,0.3)] bg-[rgba(154,240,200,0.08)] px-4 py-3.5"
              style={{ animationDelay: "0ms" }}
            >
              <p className="text-[13px] leading-relaxed text-ink">
                ✦ <b>{summary.entityCount}</b>{" "}
                {summary.entityCount === 1 ? "entity" : "entities"} now live in your sky
                {summary.conceptIds.length
                  ? ` · ${summary.conceptIds.length} new concept${summary.conceptIds.length === 1 ? "" : "s"}`
                  : ""}
                . Find it in Universe to read your annotated text again.
              </p>
            </div>
          )}
            </>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-[var(--color-line)] px-4 py-3">
          <span
            className="text-[11px] text-[var(--color-faint)]"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {(viewing?.body ?? text).trim().split(/\s+/).filter(Boolean).length} words
          </span>
          <div className="flex flex-wrap gap-2">
            {viewing ? (
              viewing.thought_id ? (
                <button className="btn btn-gold" onClick={() => onExplore(viewing.thought_id!)}>
                  <Compass size={13} /> Explore in sky
                </button>
              ) : (
                <button className="btn btn-gold" onClick={() => resumeDraft(viewing)}>
                  <Sparkles size={13} /> Continue editing
                </button>
              )
            ) : (
              <>
                {phase === "review" && (
                  <button
                    className="btn btn-gold"
                    disabled={working || !extraction?.entities.length}
                    onClick={() => void runWeave()}
                  >
                    <Sparkles size={13} />
                    Accept &amp; weave in
                  </button>
                )}
                {phase === "complete" && summary && (
                  <>
                    <button className="btn" onClick={resetRun}>
                      Write another
                    </button>
                    <button className="btn btn-gold" onClick={() => onExplore(summary.thoughtId)}>
                      <Compass size={13} />
                      Explore in sky
                    </button>
                  </>
                )}
                {phase === "idle" && (
                  <button
                    className="btn btn-gold"
                    disabled={!text.trim() || working}
                    onClick={() => void run()}
                    style={{ minWidth: 160, justifyContent: "center" }}
                  >
                    <Sparkles size={14} />
                    Extract & weave
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
