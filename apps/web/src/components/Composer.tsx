"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookMarked, Check, FileText, Loader2, Lock, Megaphone, PenLine, RotateCcw,
  Search as SearchIcon, Send, Sparkles, Trash2, X,
} from "lucide-react";
import {
  analyzeComposerText,
  applyMention,
  parseActiveMention,
  type AgentMessage,
  type AgentStreamEvent,
  type ComposerIntent,
  type GNode,
  type ResolvedMention,
} from "@constellation/graph-core";
import { useUI } from "@/lib/store";
import { addTrust, resolveScope, trustSearch, type TrustRec } from "@/lib/trustClient";
import { AgentUnavailableError, streamAgentTurn } from "@/lib/agentClient";
import {
  deleteWorkspaceDoc, fetchWorkspace, fetchWriting, saveDraft, updateWorkspaceDoc,
  type WritingSummary,
} from "@/lib/writings";
import { GOLD } from "@/lib/palette";
import AgentChat, {
  TOOL_LABEL,
  type AgentChatEntry,
  type TrustToolData,
} from "./composer/AgentChat";
import MentionPopover from "./composer/MentionPopover";
import JourneysPanel from "./composer/JourneysPanel";
import PanelShell from "./dock/PanelShell";
import WeaveFlow from "./composer/WeaveFlow";
import type { JourneySummary } from "@/lib/journeysClient";
import type { SourceMode } from "@/lib/dataSource";
import type { ExtractStreamEvent } from "@/lib/extractClient";
import type { TrustAssertion } from "@/lib/trustClient";
import type { ThoughtExtraction } from "@constellation/graph-core";

/**
 * Unified AI Composer (#29) + Personal Knowledge Workspace (#31).
 *
 * ONE input, agent-first: your message goes to a real tool-calling agent
 * (extractor /agent/stream — trust search, entity lookup, private notes, asks,
 * recommendations, trust edges, listen requests) with a live Cursor-style tool
 * trace. Outward-facing actions pause on a confirm card — nothing reaches your
 * network without your click. When no LLM is configured the composer degrades
 * to the original heuristic quick mode (intent chips + direct actions), so the
 * private workspace below always works.
 */

const DRAFT_KEY = "trusty_composer_draft_v1";

const INTENT_META: Record<ComposerIntent, { label: string; icon: React.ElementType; color: string }> = {
  search: { label: "Search", icon: SearchIcon, color: "#3fc6f4" },
  question: { label: "Question", icon: SearchIcon, color: "#3fc6f4" },
  recommendation: { label: "Recommendation", icon: Megaphone, color: "#ff8c5a" },
  experience: { label: "Experience", icon: Sparkles, color: "#54d26e" },
  decision_update: { label: "Decision", icon: Check, color: "#e25cff" },
  note: { label: "Private note", icon: FileText, color: "#8e97bd" },
  unknown: { label: "…", icon: FileText, color: "#8e97bd" },
};

const KIND_FOR_INTENT: Record<ComposerIntent, string> = {
  search: "note",
  question: "note",
  recommendation: "recommendation_draft",
  experience: "experience",
  decision_update: "decision",
  note: "note",
  unknown: "note",
};

export default function Composer({
  nodes,
  mode,
  pending,
  onExtract,
  onWeave,
  onExplore,
}: {
  nodes: GNode[];
  /** Weave pipeline (#31) — handlers live in GraphExplorer (they mutate the dataset). */
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
}) {
  const setTrustSearch = useUI((s) => s.setTrustSearch);
  const open = useUI((s) => s.rightPanel === "composer");
  const setRightPanel = useUI((s) => s.setRightPanel);
  const [text, setText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [docs, setDocs] = useState<WritingSummary[]>([]);
  const [collections, setCollections] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [activeCollection, setActiveCollection] = useState<string | null>(null);

  // Agent conversation (#29): the transcript is server-canonical — we store what
  // `done` returned and resend it each turn (the loop is stateless over HTTP).
  const [agentMode, setAgentMode] = useState(true);
  const [chat, setChat] = useState<AgentChatEntry[]>([]);
  const [sending, setSending] = useState(false);
  const transcriptRef = useRef<AgentMessage[]>([]);
  const sessionIdRef = useRef<string>("");
  if (!sessionIdRef.current && typeof crypto !== "undefined") {
    sessionIdRef.current = crypto.randomUUID?.() ?? `s_${Date.now().toString(36)}`;
  }
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Mentions (#29): @people / #topics / [[entities]] — caret-tracked token +
  // resolved-id map, so the agent receives node ids, not guesses.
  const [caret, setCaret] = useState(0);
  const [mentionDismissed, setMentionDismissed] = useState(false);
  const mentionMapRef = useRef<Map<string, ResolvedMention>>(new Map());

  // Weave flow (#31): extract→review→weave inline (the old Write view, merged).
  const [weave, setWeave] = useState<{ text: string; precomputed?: ThoughtExtraction } | null>(null);

  // Decision journeys (#35): agent tools create/update them — refresh after turns.
  const [journeyNonce, setJourneyNonce] = useState(0);

  // Draft preservation (#29): survive refresh/crash/navigation.
  useEffect(() => {
    const saved = localStorage.getItem(DRAFT_KEY);
    if (saved) setText(saved);
  }, []);
  useEffect(() => {
    if (text) localStorage.setItem(DRAFT_KEY, text);
    else localStorage.removeItem(DRAFT_KEY);
  }, [text]);

  const analysis = useMemo(() => analyzeComposerText(text), [text]);

  const activeMention = useMemo(
    () => (mentionDismissed ? null : parseActiveMention(text, caret)),
    [text, caret, mentionDismissed],
  );

  const pickMention = (replacement: string, resolved: ResolvedMention) => {
    if (!activeMention) return;
    const r = applyMention(text, caret, activeMention, replacement);
    mentionMapRef.current.set(resolved.token, resolved);
    setText(r.text);
    setCaret(r.caret);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(r.caret, r.caret);
    });
  };

  /** Structured mentions to ship with an agent turn: resolved tokens still in
   *  the text, plus loose label matches as a fallback. */
  const collectMentions = (t: string): ResolvedMention[] => {
    const out = new Map<string, ResolvedMention>();
    for (const [token, m] of mentionMapRef.current) {
      if (t.includes(token)) out.set(token, m);
    }
    for (const n of mentioned) {
      if (![...out.values()].some((m) => m.id === n.id)) {
        out.set(n.label, { token: n.label, id: n.id, type: n.type, label: n.label });
      }
    }
    return [...out.values()].slice(0, 24);
  };

  // Entities the text mentions — matched against the live graph (suggestions).
  const mentioned = useMemo(() => {
    const lower = text.toLowerCase();
    if (lower.length < 3) return [];
    return nodes
      .filter((n) => !n.isMe && n.label && n.label.length >= 3 && lower.includes(n.label.toLowerCase()))
      .slice(0, 4);
  }, [text, nodes]);
  const target = mentioned.find((n) => n.type !== "person") ?? mentioned[0] ?? null;

  const loadDocs = useCallback(async () => {
    const w = await fetchWorkspace({ q: q || undefined, collection: activeCollection ?? undefined });
    setDocs(w.writings);
    setCollections(w.collections);
  }, [q, activeCollection]);
  useEffect(() => {
    if (open) void loadDocs();
  }, [open, loadDocs]);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2400);
  };

  const clearEditor = () => {
    setText("");
    setEditingId(null);
    localStorage.removeItem(DRAFT_KEY);
  };

  /* --------------------------- agent turns --------------------------- */

  /** Patch the last (streaming) assistant entry. */
  const patchTail = useCallback((fn: (e: AgentChatEntry) => AgentChatEntry) => {
    setChat((prev) => {
      for (let i = prev.length - 1; i >= 0; i--) {
        if (prev[i].role === "assistant") {
          const next = [...prev];
          next[i] = fn(next[i]);
          return next;
        }
      }
      return prev;
    });
  }, []);

  const handleEvent = useCallback(
    (ev: AgentStreamEvent) => {
      if (ev.type === "step") {
        patchTail((e) => {
          const trace = [...e.trace];
          const i = trace.findIndex((t) => t.id === ev.id);
          const item = { id: ev.id, label: ev.label, status: ev.status, summary: ev.summary };
          if (i >= 0) trace[i] = { ...trace[i], ...item };
          else trace.push(item);
          return { ...e, trace };
        });
      } else if (ev.type === "tool_call") {
        patchTail((e) => ({
          ...e,
          trace: [
            ...e.trace,
            { id: ev.id, label: TOOL_LABEL[ev.tool] ?? ev.tool.replace(/_/g, " "), status: "active" as const, tool: ev.tool },
          ],
        }));
      } else if (ev.type === "tool_result") {
        patchTail((e) => {
          const trace = e.trace.map((t) =>
            t.id === ev.id ? { ...t, status: ev.ok ? ("done" as const) : ("error" as const), summary: ev.summary } : t,
          );
          const trustData =
            ev.tool === "trust_search" && ev.ok && ev.data
              ? (ev.data as TrustToolData)
              : e.trustData;
          const weaveData =
            ev.tool === "extract_entities" && ev.ok && ev.data
              ? (ev.data as { text: string; extraction: ThoughtExtraction })
              : e.weaveData;
          return { ...e, trace, trustData, weaveData };
        });
      } else if (ev.type === "token") {
        patchTail((e) => ({ ...e, text: e.text + ev.content }));
      } else if (ev.type === "confirm") {
        patchTail((e) => ({
          ...e,
          confirm: { id: ev.id, tool: ev.tool, args: ev.args, title: ev.title, description: ev.description },
        }));
      }
    },
    [patchTail],
  );

  // Plain function (not useCallback): it closes over the freshest mention map
  // + graph nodes, and only event handlers call it.
  const runTurn = async (
    input: { text?: string; resume?: { toolCallId: string; approved: boolean; args?: unknown; reason?: string } },
  ) => {
      setSending(true);
      setChat((prev) => [
        ...prev,
        ...(input.text ? [{ role: "user" as const, text: input.text, trace: [] }] : []),
        { role: "assistant" as const, text: "", trace: [], streaming: true },
      ]);
      try {
        const result = await streamAgentTurn(
          {
            transcript: transcriptRef.current,
            ...(input.text ? { text: input.text, mentions: collectMentions(input.text) } : {}),
            ...(input.resume ? { resume: input.resume } : {}),
            sessionId: sessionIdRef.current,
          },
          handleEvent,
        );
        transcriptRef.current = result.transcript;
        patchTail((e) => ({ ...e, streaming: false }));
        void loadDocs(); // the agent may have saved a note / created an ask
        setJourneyNonce((n) => n + 1); // …or started/refined a decision journey
        return true;
      } catch (err) {
        if (err instanceof AgentUnavailableError) {
          // Drop the optimistic entries and fall back to quick mode for the session.
          setChat((prev) => prev.slice(0, input.text ? -2 : -1));
          setAgentMode(false);
          flash("AI agent offline — quick mode (heuristics) active.");
        } else {
          patchTail((e) => ({
            ...e,
            streaming: false,
            trace: [
              ...e.trace,
              { id: `err_${Date.now()}`, label: "Agent error", status: "error" as const, summary: err instanceof Error ? err.message : String(err) },
            ],
          }));
        }
        return false;
      } finally {
        setSending(false);
      }
  };

  const sendToAgent = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setText("");
    localStorage.removeItem(DRAFT_KEY);
    await runTurn({ text: t });
  };

  const decide = async (confirmId: string, approved: boolean, args?: unknown) => {
    if (sending) return;
    setChat((prev) =>
      prev.map((e) =>
        e.confirm?.id === confirmId
          ? { ...e, confirm: { ...e.confirm, decided: approved ? "approved" : "denied" } }
          : e,
      ),
    );
    await runTurn({ resume: { toolCallId: confirmId, approved, args } });
  };

  const newChat = () => {
    transcriptRef.current = [];
    sessionIdRef.current = crypto.randomUUID?.() ?? `s_${Date.now().toString(36)}`;
    setChat([]);
  };

  /* ---------------------- quick mode (no LLM) ------------------------ */

  /** Save privately to the workspace — always available, never needs the LLM (#31). */
  const save = async () => {
    if (!text.trim()) return;
    setBusy("save");
    try {
      const kind = KIND_FOR_INTENT[analysis.primary];
      const title = text.trim().split("\n")[0].slice(0, 60);
      if (editingId) {
        await updateWorkspaceDoc(editingId, { title, body: text, kind, collections: analysis.topics });
      } else {
        await saveDraft({
          id: `ws_${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`,
          title,
          body: text,
          extraction: { entities: [], relations: [] },
          kind,
          collections: analysis.topics,
        });
      }
      clearEditor();
      await loadDocs();
      flash("Saved privately to your workspace 🔒");
    } finally {
      setBusy(null);
    }
  };

  /** Search intent → the trust-search graph overlay (quick mode routing). */
  const runSearch = async () => {
    setBusy("search");
    try {
      const scope = await resolveScope(text).catch(() => null);
      const topic = scope?.topic ?? analysis.topics[0];
      if (!topic) {
        flash("Couldn't tell the topic — mention it (e.g. lawyer, dentist).");
        return;
      }
      const res = await trustSearch({ topic, geo: scope?.geo, context: scope?.context });
      setTrustSearch({ topic, geo: scope?.geo, recs: res.recommendations });
      flash(
        res.recommendations.length
          ? `${res.recommendations.length} result${res.recommendations.length === 1 ? "" : "s"} — lit up on the graph`
          : "No trusted results yet — try listening to more people.",
      );
    } finally {
      setBusy(null);
    }
  };

  /** Explicit publication (quick mode; the agent path uses the merged recommend
   *  tool). Merged semantics: recommending also records the trust edge. */
  const publish = async () => {
    if (!target || !analysis.topics[0]) return;
    setBusy("publish");
    try {
      await addTrust({ to: target.id, scope: { topic: analysis.topics[0] } }).catch(() => {
        /* trust edge is best-effort here — the publication is the explicit act */
      });
      const r = await fetch("/api/recs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          targetId: target.id,
          topic: analysis.topics[0],
          note: text.slice(0, 500),
        }),
      });
      if (!r.ok) {
        flash((await r.json()).error ?? "Publish failed");
        return;
      }
      if (editingId) await updateWorkspaceDoc(editingId, { status: "published" });
      clearEditor();
      await loadDocs();
      flash("Published — your listeners will see it 📣");
    } finally {
      setBusy(null);
    }
  };

  const editDoc = async (id: string) => {
    const d = await fetchWriting(id);
    if (!d) return;
    setEditingId(id);
    setText(d.body);
  };

  const removeDoc = async (id: string) => {
    await deleteWorkspaceDoc(id);
    if (editingId === id) clearEditor();
    await loadDocs();
  };

  const primary = INTENT_META[analysis.primary];
  const showSearch = !agentMode && analysis.intents.some((g) => (g.intent === "search" || g.intent === "question") && g.confidence >= 0.5);
  const showPublish = !agentMode && analysis.primary === "recommendation" && !!target && !!analysis.topics[0];

  if (!open) return null;

  return (
    <PanelShell
      title={editingId ? "Edit note" : "Compose"}
      icon={<PenLine size={15} />}
      onClose={() => setRightPanel(null)}
      headerExtra={
        <div className="flex shrink-0 items-center gap-1.5 text-[10.5px] text-[var(--color-faint)]">
          {agentMode ? (
            <><Sparkles size={11} style={{ color: "var(--color-accent)" }} /> AI agent</>
          ) : (
            <>Quick mode — agent offline</>
          )}
          {chat.length > 0 && (
            <button type="button" onClick={newChat} title="New conversation" className="ml-1 flex items-center gap-1 text-dim hover:text-ink">
              <RotateCcw size={11} /> new
            </button>
          )}
        </div>
      }
    >
      <div className="p-4">
        {/* agent conversation */}
        <AgentChat
          entries={chat}
          busy={sending}
          onDecide={(id, approved, args) => void decide(id, approved, args)}
          onShowOnGraph={(d: TrustToolData) =>
            setTrustSearch({ topic: d.topic, geo: d.geo, recs: d.recs as TrustRec[] })
          }
          onWeaveRequest={(t, extraction) => setWeave({ text: t, precomputed: extraction })}
        />

        {/* weave flow (#31) — the merged Write view, inline */}
        {weave && (
          <div className="mb-3">
            <WeaveFlow
              text={weave.text}
              mode={mode}
              pending={pending}
              precomputed={weave.precomputed}
              onExtract={onExtract}
              onWeave={onWeave}
              onExplore={(id) => {
                setWeave(null);
                onExplore(id);
              }}
              onClose={() => setWeave(null)}
            />
          </div>
        )}

        {/* the ONE input */}
        <textarea
          autoFocus
          ref={inputRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setCaret(e.target.selectionStart ?? e.target.value.length);
            setMentionDismissed(false);
          }}
          onClick={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
          onKeyUp={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
          onKeyDown={(e) => {
            // While the mention popover is open its capture-phase handler owns
            // Enter/arrows — this only fires for plain typing.
            if (agentMode && e.key === "Enter" && !e.shiftKey && !activeMention) {
              e.preventDefault();
              void sendToAgent();
            }
          }}
          rows={chat.length ? 3 : 5}
          placeholder={
            agentMode
              ? "Ask, need, recommend, note… the agent detects intent, searches your network and acts — outward actions wait for your OK. Enter to send, Shift+Enter for a new line."
              : "Write naturally — search, recommend, capture an experience, note a decision… the heuristics sort it out."
          }
          className="w-full resize-none rounded-xl border border-[var(--color-line)] bg-[rgba(146,166,255,0.06)] p-3 text-[13px] leading-relaxed text-ink outline-none placeholder:text-[var(--color-faint)] focus:border-[rgba(255,140,90,0.4)]"
        />

        {/* mention autocomplete: @people · #topics · [[entities]] */}
        {activeMention && (
          <MentionPopover
            active={activeMention}
            nodes={nodes}
            onPick={pickMention}
            onClose={() => setMentionDismissed(true)}
          />
        )}

        {/* AI transparency: what was understood */}
        {text.trim() && (
          <div className="mt-2 space-y-1.5">
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="text-[var(--color-faint)]">Looks like:</span>
              <span className="flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold"
                style={{ background: `${primary.color}22`, color: primary.color }}>
                <primary.icon size={11} /> {primary.label}
              </span>
              {analysis.mixed && (
                <span className="text-[10.5px] text-[var(--color-faint)]">
                  + {[...new Set(analysis.intents.filter((g) => g.confidence >= 0.5 && g.intent !== analysis.primary).map((g) => INTENT_META[g.intent].label))].join(", ")}
                </span>
              )}
              {analysis.topics.map((t) => (
                <span key={t} className="rounded-full bg-[rgba(146,166,255,0.1)] px-2 py-0.5 text-[10.5px] text-[var(--color-dim)]">
                  #{t.replace(/_/g, " ")}
                </span>
              ))}
            </div>
            {mentioned.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className="text-[var(--color-faint)]">Mentions:</span>
                {mentioned.map((n) => (
                  <span key={n.id} className="rounded-full border border-[var(--color-line)] px-2 py-0.5 text-[10.5px] text-ink">
                    {n.label}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* actions */}
        <div className="mt-3 flex flex-wrap gap-2">
          {agentMode && text.trim() && (
            <button onClick={() => void sendToAgent()} disabled={sending}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-bold text-space disabled:opacity-50"
              style={{ background: GOLD }}>
              {sending ? <Loader2 className="animate-spin" size={13} /> : <Send size={13} />} Send
            </button>
          )}
          {showSearch && (
            <button onClick={() => void runSearch()} disabled={busy !== null}
              className="flex items-center gap-1.5 rounded-lg border border-[rgba(63,198,244,0.5)] bg-[rgba(63,198,244,0.08)] px-3 py-1.5 text-[12px] font-semibold text-[#3fc6f4] disabled:opacity-50">
              {busy === "search" ? <Loader2 className="animate-spin" size={13} /> : <SearchIcon size={13} />} Search my network
            </button>
          )}
          {text.trim() && (
            <button onClick={() => void save()} disabled={busy !== null}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--color-line)] bg-[rgba(146,166,255,0.08)] px-3 py-1.5 text-[12px] font-semibold text-ink disabled:opacity-50">
              {busy === "save" ? <Loader2 className="animate-spin" size={13} /> : <Lock size={13} />}
              {editingId ? "Save changes" : "Save privately"}
            </button>
          )}
          {text.trim().length >= 12 && !weave && (
            <button onClick={() => setWeave({ text })} disabled={pending}
              title="Extract entities from this text and weave them into your knowledge graph"
              className="flex items-center gap-1.5 rounded-lg border border-[rgba(154,240,200,0.5)] bg-[rgba(154,240,200,0.08)] px-3 py-1.5 text-[12px] font-semibold text-[#9af0c8] disabled:opacity-50">
              <Sparkles size={13} /> Weave into my sky
            </button>
          )}
          {showPublish && (
            <button onClick={() => void publish()} disabled={busy !== null}
              title={`Publish as a recommendation of ${target?.label} (#${analysis.topics[0]}) — reaches your listeners`}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold text-space disabled:opacity-50"
              style={{ background: GOLD }}>
              {busy === "publish" ? <Loader2 className="animate-spin" size={13} /> : <Megaphone size={13} />} Publish
            </button>
          )}
          {editingId && (
            <button onClick={clearEditor} className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11.5px] text-[var(--color-faint)] hover:text-ink">
              <X size={12} /> new note
            </button>
          )}
        </div>
        {!agentMode && analysis.primary === "recommendation" && !showPublish && text.trim() && (
          <p className="mt-1.5 text-[10.5px] text-[var(--color-faint)]">
            To publish: mention who/what you recommend by name{analysis.topics.length ? "" : " and the topic (e.g. lawyer)"} — or just save it privately for now.
          </p>
        )}
        {toast && <div className="mt-2 rounded-lg bg-[rgba(84,210,110,0.1)] px-2.5 py-1.5 text-[11.5px] text-[#54d26e]">{toast}</div>}

        {/* decision journeys (#35) */}
        <JourneysPanel
          refreshKey={journeyNonce}
          onDiscuss={(j: JourneySummary) => {
            if (sending || !agentMode) return;
            void runTurn({
              text: `Continue my "${j.title}" decision journey (id ${j.id}) — summarize where I stand and suggest the next step.`,
            });
          }}
        />

        {/* workspace (#31) */}
        <div className="mt-5 border-t border-line pt-3">
          <div className="mb-2 flex items-center gap-2">
            <BookMarked size={13} className="text-[var(--color-dim)]" />
            <span className="text-[12px] font-semibold text-ink">My workspace</span>
            <span className="text-[10px] text-[var(--color-faint)]">only you can see this</span>
          </div>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void loadDocs()}
            onBlur={() => void loadDocs()}
            placeholder="Search your notes…"
            className="mb-2 w-full rounded-lg border border-[var(--color-line)] bg-[rgba(146,166,255,0.06)] px-2.5 py-1.5 text-[12px] text-ink outline-none placeholder:text-[var(--color-faint)]"
          />
          {collections.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1">
              {collections.map((c) => (
                <button key={c} onClick={() => setActiveCollection(activeCollection === c ? null : c)}
                  className="rounded-full border px-2 py-0.5 text-[10.5px]"
                  style={{
                    borderColor: activeCollection === c ? "rgba(255,140,90,0.6)" : "var(--color-line)",
                    color: activeCollection === c ? GOLD : "var(--color-faint)",
                  }}>
                  {c.replace(/_/g, " ")}
                </button>
              ))}
            </div>
          )}
          {docs.length === 0 ? (
            <p className="py-2 text-[11.5px] text-[var(--color-faint)]">
              Nothing here yet — whatever you write above lands here, private, searchable, versioned.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {docs.map((d) => (
                <li key={d.id} className="group flex items-start gap-2 rounded-xl border border-[var(--color-line)] p-2.5 transition hover:border-[rgba(255,140,90,0.35)]">
                  <button onClick={() => void editDoc(d.id)} className="min-w-0 flex-1 text-left">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[12.5px] font-medium text-ink">{d.title || "Untitled"}</span>
                      <span className="shrink-0 rounded-full bg-[rgba(146,166,255,0.1)] px-1.5 py-0.5 text-[9.5px] uppercase tracking-wide text-[var(--color-faint)]">
                        {(d.kind ?? "note").replace(/_/g, " ")}
                      </span>
                      {d.status === "published" && (
                        <span className="shrink-0 rounded-full bg-[rgba(255,140,90,0.12)] px-1.5 py-0.5 text-[9.5px]" style={{ color: GOLD }}>published</span>
                      )}
                    </div>
                    {d.snippet && <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-[var(--color-faint)]">{d.snippet}</div>}
                    <div className="mt-0.5 text-[10px] text-[var(--color-faint)]">{new Date(d.updated_at).toLocaleDateString()}</div>
                  </button>
                  <button onClick={() => void removeDoc(d.id)} aria-label="Delete"
                    className="rounded p-1 text-[var(--color-faint)] opacity-0 transition hover:text-rose-300 group-hover:opacity-100">
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </PanelShell>
  );
}
