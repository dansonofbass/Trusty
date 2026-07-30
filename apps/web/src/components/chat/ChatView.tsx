"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import GuideSheet from "./GuideSheet";
import { Megaphone, Plus, RotateCcw, Sparkles, UserPlus } from "lucide-react";
import { analyzeComposerText, type ThoughtExtraction } from "@constellation/graph-core";
import AgentChat, { type TrustToolData } from "@/components/composer/AgentChat";
import WeaveFlow from "@/components/composer/WeaveFlow";
import ChatInput from "./ChatInput";
import { useUI } from "@/lib/store";
import { spaceFromHost } from "@/lib/space";
import { useGraphData } from "@/lib/graph/GraphDataProvider";
import { useChat } from "@/lib/chat/ChatProvider";
import { resolveScope, trustSearch as runTrustSearch, type TrustRec } from "@/lib/trustClient";
import { saveDraft } from "@/lib/writings";

interface HeroCard {
  title: string;
  sub: string;
  prompt?: string;
  href?: string;
}

/** Space-aware hero suggestions: each community's front door teaches ITS jobs. */
function heroCardsForSpace(space: string | null): HeroCard[] {
  if (space === "summit") {
    return [
      { title: "🎪 Get set up for the Summit", prompt: "/summit set me up", sub: "Profile, program, squad — 1 minute" },
      { title: "🤝 Who should I meet?", prompt: "/summit who should I meet?", sub: "Mentor & founder matches, with reasons" },
      { title: "🗓 What's on today?", prompt: "/summit what's on the agenda today?", sub: "Today's sessions, by program" },
      { title: "🔍 Find someone trusted", prompt: "Find a trusted dentist in Yerevan", sub: "Search your network's real experience" },
    ];
  }
  if (space === "irham") {
    return [
      { title: "🏛 Residency & documents", prompt: "What documents do I need for the residency application?", sub: "Saved community answers, with author + date" },
      { title: "🧾 Find a trusted accountant", prompt: "Find a trusted accountant for my IE", sub: "Ranked by your community's real experience" },
      { title: "⭕ Join the circles", href: "/discover", sub: "Residency · Accounting · Jobs · Health — pick yours" },
      { title: "📣 Ask the community", prompt: "Ask my network: which bank is currently opening accounts?", sub: "Reaches people who listen to you" },
    ];
  }
  return [
    { title: "🔍 Find someone trusted", prompt: "Find a trusted dentist in Yerevan", sub: "Search your network's real experience" },
    { title: "⭕ Create a circle", href: "/messages", sub: "A group chat + shared memory for your community" },
    { title: "📝 Capture a thought", prompt: "Note: ", sub: "Notes link people, places and ideas automatically" },
    { title: "📣 Ask your network", prompt: "Ask my network: ", sub: "Broadcast a need to people who listen to you" },
  ];
}

const KIND_FOR_INTENT: Record<string, string> = {
  search: "note",
  question: "note",
  recommendation: "recommendation_draft",
  experience: "experience",
  decision_update: "decision",
  note: "note",
  unknown: "note",
};

/**
 * The center stage's default view: the agent chat. Hero prompt when the
 * thread is empty ("What are you looking for?"), Cursor-style thread once a
 * conversation starts. Sessions are ephemeral in P1 — persistence is Phase 2.
 */
export default function ChatView() {
  const router = useRouter();
  const { dataset, mode, pending, handleExtract, handleWeave } = useGraphData();
  const { chat, sending, agentMode, runTurn, decide, newChat } = useChat();

  const select = useUI((s) => s.select);
  const setTrustSearch = useUI((s) => s.setTrustSearch);
  const requestGraphCenter = useUI((s) => s.requestGraphCenter);
  const setFocus = useUI((s) => s.setFocus);
  const setView = useUI((s) => s.setView);
  const setRightPanel = useUI((s) => s.setRightPanel);
  const chatPrefill = useUI((s) => s.chatPrefill);
  const setChatPrefill = useUI((s) => s.setChatPrefill);
  const bumpDocs = useUI((s) => s.bumpDocs);

  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [weave, setWeave] = useState<{ text: string; precomputed?: ThoughtExtraction } | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // QR deep link: /?connect=<nodeId> opens that person in the Inspector.
  const searchParams = useSearchParams();
  const connectParam = searchParams.get("connect");
  useEffect(() => {
    if (!connectParam) return;
    select(connectParam);
    router.replace("/");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectParam]);

  const [guideOpen, setGuideOpen] = useState(false);
  const hero = chat.length === 0 && !weave;

  // Keep the thread pinned to the newest turn.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat, sending]);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  };

  const showOnGraph = (d: TrustToolData) => {
    setTrustSearch({ topic: d.topic, geo: d.geo, recs: d.recs as TrustRec[] });
    router.push("/graph");
  };

  /** Quick-mode search (agent offline): resolve scope → trust search → graph. */
  const quickSearch = async (text: string) => {
    setBusy("search");
    try {
      const scope = await resolveScope(text).catch(() => null);
      const topic = scope?.topic ?? analyzeComposerText(text).topics[0];
      if (!topic) {
        flash("Couldn't tell the topic — mention it (e.g. lawyer, dentist).");
        return;
      }
      const res = await runTrustSearch({ topic, geo: scope?.geo, context: scope?.context });
      setTrustSearch({ topic, geo: scope?.geo, recs: res.recommendations });
      if (res.recommendations.length) router.push("/graph");
      else flash("No trusted results yet — try listening to more people.");
    } finally {
      setBusy(null);
    }
  };

  /** Save privately to the workspace — always available, never needs the LLM. */
  const quickSave = async (text: string) => {
    setBusy("save");
    try {
      const analysis = analyzeComposerText(text);
      await saveDraft({
        id: `ws_${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`,
        title: text.trim().split("\n")[0].slice(0, 60),
        body: text,
        extraction: { entities: [], relations: [] },
        kind: KIND_FOR_INTENT[analysis.primary] ?? "note",
        collections: analysis.topics,
      });
      bumpDocs();
      flash("Saved privately to your workspace 🔒");
      return true;
    } finally {
      setBusy(null);
    }
  };

  const heroChips = (
    <div className="mt-3 flex items-center justify-center gap-2">
      <button
        type="button"
        onClick={() => setRightPanel("addEntity")}
        className="flex items-center gap-1.5 rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] px-3.5 py-1.5 text-[12px] font-medium text-[var(--color-dim)] backdrop-blur-md transition hover:text-ink"
      >
        <Plus size={13} /> Add
      </button>
      <button
        type="button"
        onClick={() => router.push("/asks")}
        className="flex items-center gap-1.5 rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] px-3.5 py-1.5 text-[12px] font-medium text-[var(--color-dim)] backdrop-blur-md transition hover:text-ink"
      >
        <Megaphone size={13} /> Asks
      </button>
      <button
        type="button"
        onClick={() => setRightPanel("invite")}
        className="flex items-center gap-1.5 rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] px-3.5 py-1.5 text-[12px] font-medium text-[var(--color-dim)] backdrop-blur-md transition hover:text-ink"
      >
        <UserPlus size={13} /> Invite
      </button>
    </div>
  );

  const input = (
    <ChatInput
      nodes={dataset.nodes}
      agentMode={agentMode}
      sending={sending}
      busy={busy}
      prefill={chatPrefill}
      onPrefillConsumed={() => setChatPrefill(null)}
      onSend={(text, mentions, skill) => void runTurn({ text, mentions, skill })}
      onQuickSearch={(t) => void quickSearch(t)}
      onQuickSave={quickSave}
      onWeave={(t) => setWeave({ text: t })}
      compact={!hero}
    />
  );

  if (hero) {
    return (
      <div className="scroll-quiet flex h-full flex-col overflow-y-auto px-4 py-6 md:px-6">
        <div className="m-auto w-full max-w-[680px]">
          <h1
            className="text-center text-[26px] font-bold leading-tight text-ink md:text-[34px]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            What are you looking for?
          </h1>
          <p className="mb-6 mt-2 text-center text-[13.5px] leading-relaxed text-[var(--color-dim)]">
            The agent interprets your needs, navigates your network, and acts upon your approval.
          </p>
          {input}
          {heroChips}
          {/* Try-asking guide: space-aware suggestion cards — one tap runs the
              prompt (or routes); "everything" opens the full command catalog. */}
          <div className="mx-auto mt-6 grid w-full max-w-[620px] grid-cols-1 gap-2 sm:grid-cols-2">
            {heroCardsForSpace(spaceFromHost()).map((c) => (
              <button
                key={c.title}
                type="button"
                onClick={() => (c.href ? router.push(c.href) : void runTurn({ text: c.prompt! }))}
                className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3.5 py-2.5 text-left backdrop-blur-md transition hover:border-[var(--color-accent-line)]"
              >
                <div className="text-[12.5px] font-semibold text-ink">{c.title}</div>
                <div className="mt-0.5 text-[11px] text-[var(--color-faint)]">{c.sub}</div>
              </button>
            ))}
          </div>
          <div className="mt-2.5 text-center">
            <button
              type="button"
              onClick={() => setGuideOpen(true)}
              className="text-[11.5px] font-semibold underline decoration-dotted underline-offset-4 transition hover:text-ink"
              style={{ color: "var(--color-accent)" }}
            >
              Everything you can ask →
            </button>
          </div>
          {guideOpen && <GuideSheet onRun={(p) => void runTurn({ text: p })} onClose={() => setGuideOpen(false)} />}
          {!agentMode && (
            <p className="mt-3 text-center text-[11px] text-[var(--color-faint)]">
              AI agent offline — quick mode (heuristics) active.
            </p>
          )}
          {toast && (
            <p className="mt-3 text-center text-[11.5px] text-[#54d26e]">{toast}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="hidden items-center gap-2 border-b border-line px-5 py-2.5 md:flex">
        <Sparkles size={13} style={{ color: "var(--color-accent)" }} />
        <span className="text-[12.5px] font-semibold text-ink" style={{ fontFamily: "var(--font-display)" }}>
          {agentMode ? "AI agent" : "Quick mode — agent offline"}
        </span>
        <button
          type="button"
          onClick={newChat}
          title="New conversation"
          className="ml-auto flex items-center gap-1 text-[11px] text-[var(--color-faint)] transition hover:text-ink"
        >
          <RotateCcw size={11} /> New chat
        </button>
      </div>

      <div ref={scrollRef} className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-3 py-3 md:px-5 md:py-4">
        <div className="mx-auto w-full max-w-[760px]">
          <AgentChat
            entries={chat}
            busy={sending}
            onDecide={(id, approved, args) => void decide(id, approved, args)}
            onShowOnGraph={showOnGraph}
            onWeaveRequest={(t, extraction) => setWeave({ text: t, precomputed: extraction })}
          />

          {weave && (
            <div className="mb-3">
              <WeaveFlow
                text={weave.text}
                mode={mode}
                pending={pending}
                precomputed={weave.precomputed}
                onExtract={handleExtract}
                onWeave={handleWeave}
                onExplore={(id) => {
                  setWeave(null);
                  setFocus(id);
                  setView("universe");
                  requestGraphCenter(id);
                  router.push("/graph");
                }}
                onClose={() => setWeave(null)}
              />
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 px-2.5 pb-[max(env(safe-area-inset-bottom),10px)] md:px-5 md:pb-4">
        <div className="mx-auto w-full max-w-[760px]">
          {toast && (
            <div className="mb-2 rounded-lg bg-[rgba(84,210,110,0.1)] px-2.5 py-1.5 text-[11.5px] text-[#54d26e]">
              {toast}
            </div>
          )}
          {input}
        </div>
      </div>
    </div>
  );
}
