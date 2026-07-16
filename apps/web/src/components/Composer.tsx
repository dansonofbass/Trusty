"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BookMarked, Check, FileText, Loader2, Lock, Megaphone, PenLine, Search as SearchIcon,
  Sparkles, Trash2, X,
} from "lucide-react";
import { analyzeComposerText, type ComposerIntent, type GNode } from "@constellation/graph-core";
import { useUI } from "@/lib/store";
import { resolveScope, trustSearch } from "@/lib/trustClient";
import {
  deleteWorkspaceDoc, fetchWorkspace, fetchWriting, saveDraft, updateWorkspaceDoc,
  type WritingSummary,
} from "@/lib/writings";
import { GOLD } from "@/lib/palette";

/**
 * Unified AI Composer (#29) + Personal Knowledge Workspace (#31).
 *
 * ONE input, no modes: intent is detected continuously while typing (pure
 * graph-core heuristics, LLM refinement can slot in later) and the action row
 * adapts — search routes to the trust-search graph overlay, everything else
 * lands PRIVATELY in the workspace below. Drafts survive refresh (localStorage
 * + server drafts). Publication is always a separate, explicit act.
 */

const DRAFT_KEY = "trusty_composer_draft_v1";

const INTENT_META: Record<ComposerIntent, { label: string; icon: React.ElementType; color: string }> = {
  search: { label: "Search", icon: SearchIcon, color: "#3fc6f4" },
  question: { label: "Question", icon: SearchIcon, color: "#3fc6f4" },
  recommendation: { label: "Recommendation", icon: Megaphone, color: "#ffd97a" },
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

export default function Composer({ nodes }: { nodes: GNode[] }) {
  const setTrustSearch = useUI((s) => s.setTrustSearch);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [docs, setDocs] = useState<WritingSummary[]>([]);
  const [collections, setCollections] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [activeCollection, setActiveCollection] = useState<string | null>(null);

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

  /** Save privately to the workspace — the default destination (#31). */
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

  /** Search intent → the trust-search graph overlay (#29 routing). */
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

  /** Explicit publication (#31: publishing is always a separate act). */
  const publish = async () => {
    if (!target || !analysis.topics[0]) return;
    setBusy("publish");
    try {
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
  const showSearch = analysis.intents.some((g) => (g.intent === "search" || g.intent === "question") && g.confidence >= 0.5);
  const showPublish = analysis.primary === "recommendation" && !!target && !!analysis.topics[0];

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="Compose — write naturally; the AI figures out what you mean"
        className="fixed bottom-[124px] right-6 z-40 flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-semibold backdrop-blur-md shadow-lg"
        style={{ fontFamily: "var(--font-display)", borderColor: "rgba(255,217,122,0.45)", background: "rgba(255,217,122,0.08)", color: GOLD }}
      >
        <PenLine size={14} /> Compose
      </button>
    );
  }

  return (
    <aside className="pointer-events-auto fixed bottom-4 right-4 top-20 z-40 flex w-[400px] max-w-[calc(100vw-2rem)] flex-col rounded-2xl border border-line bg-nebula/95 shadow-2xl backdrop-blur-md">
      {/* header */}
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="flex items-center gap-2 text-[15px] font-extrabold text-ink" style={{ fontFamily: "var(--font-display)" }}>
          <PenLine size={15} style={{ color: GOLD }} /> {editingId ? "Edit note" : "Compose"}
        </h2>
        <div className="flex items-center gap-1.5 text-[10.5px] text-[var(--color-faint)]">
          <Lock size={11} /> private by default
          <button type="button" onClick={() => setOpen(false)} className="ml-2 text-dim hover:text-ink" aria-label="Close">✕</button>
        </div>
      </div>

      <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto p-4">
        {/* the ONE input */}
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          placeholder="Write naturally — search, recommend, capture an experience, note a decision… the AI sorts it out."
          className="w-full resize-none rounded-xl border border-[var(--color-line)] bg-[rgba(146,166,255,0.06)] p-3 text-[13px] leading-relaxed text-ink outline-none placeholder:text-[var(--color-faint)] focus:border-[rgba(255,217,122,0.4)]"
        />

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

        {/* adaptive actions */}
        <div className="mt-3 flex flex-wrap gap-2">
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
        {analysis.primary === "recommendation" && !showPublish && text.trim() && (
          <p className="mt-1.5 text-[10.5px] text-[var(--color-faint)]">
            To publish: mention who/what you recommend by name{analysis.topics.length ? "" : " and the topic (e.g. lawyer)"} — or just save it privately for now.
          </p>
        )}
        {toast && <div className="mt-2 rounded-lg bg-[rgba(84,210,110,0.1)] px-2.5 py-1.5 text-[11.5px] text-[#54d26e]">{toast}</div>}

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
                    borderColor: activeCollection === c ? "rgba(255,217,122,0.6)" : "var(--color-line)",
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
                <li key={d.id} className="group flex items-start gap-2 rounded-xl border border-[var(--color-line)] p-2.5 transition hover:border-[rgba(255,217,122,0.35)]">
                  <button onClick={() => void editDoc(d.id)} className="min-w-0 flex-1 text-left">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[12.5px] font-medium text-ink">{d.title || "Untitled"}</span>
                      <span className="shrink-0 rounded-full bg-[rgba(146,166,255,0.1)] px-1.5 py-0.5 text-[9.5px] uppercase tracking-wide text-[var(--color-faint)]">
                        {(d.kind ?? "note").replace(/_/g, " ")}
                      </span>
                      {d.status === "published" && (
                        <span className="shrink-0 rounded-full bg-[rgba(255,217,122,0.12)] px-1.5 py-0.5 text-[9.5px]" style={{ color: GOLD }}>published</span>
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
    </aside>
  );
}
