"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check, FileText, Loader2, Lock, Megaphone, Search as SearchIcon, Send, Sparkles,
} from "lucide-react";
import {
  analyzeComposerText,
  applyMention,
  parseActiveMention,
  type ComposerIntent,
  type GNode,
  type ResolvedMention,
} from "@constellation/graph-core";
import MentionPopover from "@/components/composer/MentionPopover";
import { GOLD } from "@/lib/palette";

/** Same key as the mobile Composer — one private draft, every surface. */
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

/**
 * The center-stage chat input — the textarea + caret-tracked mention
 * autocomplete + intent transparency chips, lifted from the Composer (#29).
 */
export default function ChatInput({
  nodes,
  agentMode,
  sending,
  busy,
  prefill,
  onPrefillConsumed,
  onSend,
  onQuickSearch,
  onQuickSave,
  onWeave,
  compact,
}: {
  nodes: GNode[];
  agentMode: boolean;
  sending: boolean;
  /** Quick-mode action in flight ("search" | "save" | null). */
  busy: string | null;
  prefill?: string | null;
  onPrefillConsumed?: () => void;
  onSend: (text: string, mentions: ResolvedMention[]) => void;
  onQuickSearch: (text: string) => void;
  onQuickSave: (text: string) => Promise<boolean>;
  onWeave: (text: string) => void;
  /** Thread mode (smaller input) vs hero mode. */
  compact: boolean;
}) {
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [mentionDismissed, setMentionDismissed] = useState(false);
  const mentionMapRef = useRef<Map<string, ResolvedMention>>(new Map());
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Draft preservation: survive refresh/crash/navigation.
  useEffect(() => {
    const saved = localStorage.getItem(DRAFT_KEY);
    if (saved) setText(saved);
  }, []);
  useEffect(() => {
    if (text) localStorage.setItem(DRAFT_KEY, text);
    else localStorage.removeItem(DRAFT_KEY);
  }, [text]);

  // Seed from outside (Decisions → "continue my journey…", palette hand-off).
  useEffect(() => {
    if (!prefill) return;
    setText(prefill);
    onPrefillConsumed?.();
    requestAnimationFrame(() => inputRef.current?.focus());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);

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

  // Entities the text mentions — matched against the live graph (suggestions).
  const mentioned = useMemo(() => {
    const lower = text.toLowerCase();
    if (lower.length < 3) return [];
    return nodes
      .filter((n) => !n.isMe && n.label && n.label.length >= 3 && lower.includes(n.label.toLowerCase()))
      .slice(0, 4);
  }, [text, nodes]);

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

  const send = () => {
    const t = text.trim();
    if (!t || sending) return;
    setText("");
    localStorage.removeItem(DRAFT_KEY);
    onSend(t, collectMentions(t));
  };

  const primary = INTENT_META[analysis.primary];
  const showSearch =
    !agentMode &&
    analysis.intents.some((g) => (g.intent === "search" || g.intent === "question") && g.confidence >= 0.5);

  return (
    <div className="relative">
      <div className="rounded-2xl border border-[var(--color-line)] bg-[color-mix(in_srgb,var(--color-card)_92%,transparent)] p-3 shadow-xl backdrop-blur-md focus-within:border-[rgba(255,140,90,0.4)]">
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
              send();
            }
          }}
          rows={compact ? 2 : 4}
          placeholder={
            agentMode
              ? "Ask, need, recommend, note… the agent detects intent, searches your network and acts — outward actions wait for your OK. Enter to send, Shift+Enter for a new line."
              : "Write naturally — search, recommend, capture an experience, note a decision… the heuristics sort it out."
          }
          className="w-full resize-none bg-transparent text-[13.5px] leading-relaxed text-ink outline-none placeholder:text-[var(--color-faint)]"
        />

        <div className="mt-1 flex flex-wrap items-center gap-2">
          {text.trim() && (
            <>
              <span
                className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold"
                style={{ background: `${primary.color}22`, color: primary.color }}
              >
                <primary.icon size={10} /> {primary.label}
              </span>
              {analysis.topics.slice(0, 3).map((t) => (
                <span key={t} className="rounded-full bg-[rgba(146,166,255,0.1)] px-2 py-0.5 text-[10px] text-[var(--color-dim)]">
                  #{t.replace(/_/g, " ")}
                </span>
              ))}
              {mentioned.slice(0, 3).map((n) => (
                <span key={n.id} className="rounded-full border border-[var(--color-line)] px-2 py-0.5 text-[10px] text-ink">
                  {n.label}
                </span>
              ))}
            </>
          )}

          <div className="ml-auto flex items-center gap-1.5">
            {showSearch && text.trim() && (
              <button
                onClick={() => onQuickSearch(text)}
                disabled={busy !== null}
                className="flex items-center gap-1.5 rounded-lg border border-[rgba(63,198,244,0.5)] bg-[rgba(63,198,244,0.08)] px-2.5 py-1.5 text-[11.5px] font-semibold text-[#3fc6f4] disabled:opacity-50"
              >
                {busy === "search" ? <Loader2 className="animate-spin" size={12} /> : <SearchIcon size={12} />} Search network
              </button>
            )}
            {text.trim() && (
              <button
                onClick={() => {
                  void onQuickSave(text).then((ok) => {
                    if (ok) {
                      setText("");
                      localStorage.removeItem(DRAFT_KEY);
                    }
                  });
                }}
                disabled={busy !== null}
                title="Save privately to your workspace"
                className="flex items-center gap-1.5 rounded-lg border border-[var(--color-line)] bg-[rgba(146,166,255,0.08)] px-2.5 py-1.5 text-[11.5px] font-semibold text-ink disabled:opacity-50"
              >
                {busy === "save" ? <Loader2 className="animate-spin" size={12} /> : <Lock size={12} />} Save
              </button>
            )}
            {text.trim().length >= 12 && (
              <button
                onClick={() => onWeave(text)}
                title="Extract entities from this text and weave them into your knowledge graph"
                className="flex items-center gap-1.5 rounded-lg border border-[rgba(154,240,200,0.5)] bg-[rgba(154,240,200,0.08)] px-2.5 py-1.5 text-[11.5px] font-semibold text-[#9af0c8]"
              >
                <Sparkles size={12} /> Weave
              </button>
            )}
            {agentMode && (
              <button
                onClick={send}
                disabled={sending || !text.trim()}
                aria-label="Send"
                className="grid h-9 w-9 place-items-center rounded-full text-space disabled:opacity-40"
                style={{ background: GOLD }}
              >
                {sending ? <Loader2 className="animate-spin" size={15} /> : <Send size={15} />}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* mention autocomplete: @people · #topics · [[entities]] */}
      {activeMention && (
        <MentionPopover
          active={activeMention}
          nodes={nodes}
          onPick={pickMention}
          onClose={() => setMentionDismissed(true)}
        />
      )}
    </div>
  );
}
