"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { entityTypesForApp, hasRole, type GNode } from "@constellation/graph-core";
import { hydrateOntology } from "@/lib/ontologyClient";
import {
  getMyProfile, getDirectoryFiltered, getContacts, getContactItems, setContactStage,
  getMeetings, respondMeeting, getProgramme, setAttending, formatSlot,
  getMyNotes, deleteNoteApi, resolveSevanQuery, streamSevanAnswer,
  CONTACT_LABELS, LIFECYCLE_STAGES,
  SUMMIT_APP, type Meeting, type ContactItem, type ProgrammeItem, type MyNote, type ViewerContext,
} from "@/lib/summitClient";
import { myAsks, askInbox, answerAsk, type MyAsk, type InboxAsk } from "@/lib/asksClient";
import { createInvite, inviteUrl } from "@/lib/inviteClient";
import ProfileCard from "./ProfileCard";
import ProfileEditor from "./ProfileEditor";
import Home from "./Home";
import NoteComposer from "./NoteComposer";
import { QRShare, QRScan, QRButtons } from "./QRConnect";
import {
  Compass, BookOpen, Calendar, Bookmark, User, Loader2, Download, Sparkles,
  Check, X as XIcon, Handshake, Lock, Users as UsersIcon, Globe, Pencil, Trash2, NotebookPen,
  Search, UserPlus, Copy, ChevronRight, Target, Network, AlertCircle,
} from "lucide-react";

type Tab = "discover" | "directory" | "schedule" | "contacts" | "me";

/** What a card tap opens: the node plus (when known) its match context. */
export interface OpenTarget {
  node: GNode;
  match?: { pct: number; reasons: string[] };
  /** Opened via QR/deep-link — show the one-tap Connect (saves as "met"). */
  connect?: boolean;
}
const TABS: { id: Tab; label: string; icon: typeof Compass }[] = [
  { id: "discover", label: "Home", icon: Compass },
  { id: "directory", label: "Directory", icon: BookOpen },
  { id: "schedule", label: "Schedule", icon: Calendar },
  { id: "contacts", label: "Contacts", icon: Bookmark },
  { id: "me", label: "Me", icon: User },
];

export default function SummitApp() {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(true);
  const [me, setMe] = useState<GNode | null>(null);
  const [tab, setTab] = useState<Tab>("discover");
  const [selected, setSelected] = useState<OpenTarget | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

  const refreshContacts = useCallback(async () => {
    try {
      const c = await getContacts();
      setSavedIds(new Set(c.map((n) => n.id)));
    } catch { /* ignore */ }
  }, []);

  const openById = useCallback(async (id: string, connect: boolean) => {
    try {
      const { nodes } = await getDirectoryFiltered({});
      const node = nodes.find((n) => n.id === id);
      if (node) setSelected({ node, connect });
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    (async () => {
      await hydrateOntology();
      try {
        setMe(await getMyProfile());
        await refreshContacts();
      } catch (e) {
        if (e instanceof Error && /401|unauthenticated/i.test(e.message)) setAuthed(false);
      }
      setReady(true);
      // QR / shared-link deep link: /summit?connect=<nodeId> opens that profile
      // with a one-tap Connect (the business-card moment).
      const connectId = new URLSearchParams(window.location.search).get("connect");
      if (connectId) {
        window.history.replaceState(null, "", "/summit");
        void openById(connectId, true);
      }
    })();
  }, [refreshContacts, openById]);

  const [qr, setQr] = useState<"share" | "scan" | null>(null);

  // Pending incoming meeting requests → badge on the Schedule tab.
  const [pendingMeetings, setPendingMeetings] = useState(0);
  useEffect(() => {
    if (!ready || !authed) return;
    getMeetings()
      .then((m) => setPendingMeetings(m.incoming.filter((x) => x.status === "requested").length))
      .catch(() => setPendingMeetings(0));
  }, [ready, authed, tab]);

  const hasProfile = !!me?.entityType && entityTypesForApp(SUMMIT_APP).some((t) => t.id === me.entityType);

  if (!ready) {
    return <div className="flex h-dvh items-center justify-center text-dim"><Loader2 className="animate-spin" size={20} /></div>;
  }
  if (!authed) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
        <Sparkles className="text-[#ff8c5a]" size={28} />
        <h1 className="text-xl font-bold text-ink" style={{ fontFamily: "var(--font-display)" }}>Trusty Sevan</h1>
        <p className="text-sm text-dim">Who should you meet next? Sign in to find founders, mentors and investors worth meeting.</p>
        <a href="/api/auth/login?register=1" className="rounded-xl bg-[#9af0c8] px-5 py-3 text-sm font-semibold text-[#04121a]">Sign in / Join</a>
      </div>
    );
  }

  return (
    <div className="relative z-10 mx-auto flex h-dvh max-w-md flex-col">
      <header className="flex items-center justify-between px-5 py-3.5">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg" style={{ background: "rgba(255,140,90,0.14)", color: "#ff8c5a" }}>✦</span>
          <span className="text-[15px] font-bold text-ink" style={{ fontFamily: "var(--font-display)" }}>Trusty Sevan</span>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 pb-24">
        {!hasProfile && tab !== "me" && (
          <button type="button" onClick={() => setTab("me")}
            className="mb-3 flex w-full items-center gap-2 rounded-xl border border-[#ff8c5a]/40 bg-[#ff8c5a]/10 px-4 py-3 text-left text-sm text-ink">
            <Sparkles size={16} className="text-[#ff8c5a]" /> Create your profile so people can find you →
          </button>
        )}

        {tab === "discover" && <Home onOpen={setSelected} savedIds={savedIds} />}
        {tab === "directory" && <Directory onOpen={setSelected} me={me} />}
        {tab === "schedule" && <Schedule />}
        {tab === "contacts" && <Contacts onOpen={setSelected} version={savedIds.size} />}
        {tab === "me" && (
          <div className="pt-1">
            {!hasProfile ? (
              <div className="mb-4 rounded-xl border border-[#ff8c5a]/30 bg-[#ff8c5a]/5 p-4">
                <h2 className="text-lg font-bold text-ink" style={{ fontFamily: "var(--font-display)" }}>Welcome to Trusty Sevan 👋</h2>
                <p className="mt-1 text-sm text-dim">Tell us who you are and what you’re looking for — we’ll show you the right people to meet, and help them find you.</p>
              </div>
            ) : (
              <h2 className="mb-3 text-lg font-bold text-ink" style={{ fontFamily: "var(--font-display)" }}>Your profile</h2>
            )}
            {hasProfile && me && <CompletenessMeter node={me} />}
            {hasProfile && me && <QRButtons onShare={() => setQr("share")} onScan={() => setQr("scan")} />}
            {hasProfile && <MyNotesJournal />}
            <ProfileEditor myNode={me} onSaved={(n) => { setMe(n); setTab("discover"); }} />
          </div>
        )}
      </main>

      <nav className="absolute inset-x-0 bottom-0 z-20 mx-auto flex max-w-md items-center justify-around border-t border-line bg-[rgba(9,13,25,0.92)] pb-[env(safe-area-inset-bottom)] backdrop-blur-md">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          const badge = t.id === "schedule" ? pendingMeetings : 0;
          return (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className="relative flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px]"
              style={{ color: active ? "#ff8c5a" : "var(--color-faint)" }}>
              <span className="relative">
                <Icon size={20} />
                {badge > 0 && (
                  <span className="absolute -right-2 -top-1 grid h-3.5 min-w-3.5 place-items-center rounded-full px-0.5 text-[8.5px] font-bold"
                    style={{ background: "#ff8c5a", color: "#04121a" }}>
                    {badge}
                  </span>
                )}
              </span>
              {t.label}
            </button>
          );
        })}
      </nav>

      {selected && (
        <ProfileCard
          node={selected.node}
          match={selected.match}
          connect={selected.connect}
          saved={savedIds.has(selected.node.id)}
          onClose={() => setSelected(null)}
          onChange={refreshContacts}
        />
      )}

      {qr === "share" && me && <QRShare nodeId={me.id} label={me.label} onClose={() => setQr(null)} />}
      {qr === "scan" && (
        <QRScan
          onFound={(id) => { setQr(null); void openById(id, true); }}
          onClose={() => setQr(null)}
        />
      )}
    </div>
  );
}

/* ------------------------------- tabs ------------------------------- */

function Directory({ onOpen, me }: { onOpen: (t: OpenTarget) => void; me: GNode | null }) {
  const types = useMemo(() => entityTypesForApp(SUMMIT_APP), []);
  const viewer = useMemo(() => viewerContext(me), [me]);
  const [type, setType] = useState<string>("");
  const [q, setQ] = useState("");
  const [industry, setIndustry] = useState("");
  const [tech, setTech] = useState("");
  const [country, setCountry] = useState("");
  const [stage, setStage] = useState("");
  const [rows, setRows] = useState<GNode[] | null>(null);

  // Facet vocabularies come from the (admin-defined) ontology itself.
  const facetOptions = useMemo(() => {
    const collect = (keys: string[]) => {
      const out = new Set<string>();
      for (const t of types) for (const f of t.fields) if (keys.includes(f.key)) f.options?.forEach((o) => out.add(o));
      return [...out].sort();
    };
    return {
      industry: collect(["sectors", "industries", "interests"]),
      tech: collect(["technologies"]),
      country: collect(["country"]),
      stage: collect(["stage", "stages"]),
    };
  }, [types]);

  const load = useCallback(async () => {
    setRows(null);
    setRows(
      (await getDirectoryFiltered({
        type: type || undefined, q: q.trim() || undefined,
        industry: industry || undefined, tech: tech || undefined,
        country: country || undefined, stage: stage || undefined,
      })).nodes,
    );
  }, [type, q, industry, tech, country, stage]);
  useEffect(() => { void load(); }, [load]);

  /* Agent search: NL query → AI-built filters → results → streamed answer.
     The work runs as visible, expandable steps (Cursor/Claude-style trace). */
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState("");
  const [answerDone, setAnswerDone] = useState(true);
  const [trace, setTrace] = useState<AgentTrace | null>(null);
  const setStep = (id: StepId, patch: Partial<ThinkStep>) =>
    setTrace((t) => (t ? { ...t, steps: t.steps.map((s) => (s.id === id ? { ...s, ...patch } : s)) } : t));

  const closeConcierge = () => { setTrace(null); setAnswer(""); setAnswerDone(true); };

  const ask = async () => {
    const query = q.trim();
    if (query.length < 3 || asking) return;
    setAsking(true);
    setAnswer("");
    setAnswerDone(false);
    setTrace({ query, steps: freshSteps(), intentChips: [], found: [] });
    try {
      const vocab = {
        types: types.map((t) => t.id),
        industry: facetOptions.industry,
        tech: facetOptions.tech,
        country: facetOptions.country,
        stage: facetOptions.stage,
        skill: [...new Set(types.flatMap((t) => t.fields.filter((f) => ["skills_offered", "expertise"].includes(f.key)).flatMap((f) => f.options ?? [])))],
      };

      // Step 1 — intent.
      const { filters } = await resolveSevanQuery(query, vocab);
      const chips = intentChips(filters, types);
      setTrace((t) => (t ? { ...t, intentChips: chips } : t));
      setStep("intent", { status: "done", summary: chips.length ? chips.map((c) => c.v).join(" · ") : "General browse" });
      // Reflect the AI's read as live facet chips.
      setType(filters.type ?? "");
      setIndustry(filters.industry ?? "");
      setTech(filters.tech ?? "");
      setCountry(filters.country ?? "");
      setStage(filters.stage ?? "");
      setQ("");

      // Step 2 — search.
      setStep("search", { status: "active" });
      const found = (await getDirectoryFiltered({
        type: filters.type, industry: filters.industry, tech: filters.tech,
        country: filters.country, stage: filters.stage, skill: filters.skill,
      })).nodes;
      setRows(found);
      setTrace((t) => (t ? { ...t, found } : t));
      setStep("search", { status: "done", summary: countLabel(found.length, filters.type, types) });

      // Step 3 — read the graph & compose the answer.
      setStep("answer", { status: "active" });
      await streamSevanAnswer(
        query,
        found.slice(0, 8).map((n) => ({ label: n.label, entityType: n.entityType, sub: n.sub })),
        (t) => setAnswer((a) => a + t),
        viewer,
      );
      setStep("answer", { status: "done" });
    } catch (e) {
      setAnswer(e instanceof Error ? `Search assistant unavailable — ${e.message}` : "Search assistant unavailable.");
      setTrace((t) => (t ? { ...t, steps: t.steps.map((s) => (s.status === "active" || s.status === "pending" ? { ...s, status: "error" as const } : s)) } : t));
    } finally {
      setAnswerDone(true);
      setAsking(false);
    }
  };

  const facetCls = "min-w-0 flex-1 rounded-lg border border-line bg-space/60 px-2 py-1.5 text-[12px] text-ink outline-none";

  const activeFacets = [type, industry, tech, country, stage].filter(Boolean).length;

  return (
    <div className="space-y-3 pt-1">
      <form onSubmit={(e) => { e.preventDefault(); void ask(); }} className="relative">
        <div className={`flex items-center gap-2 rounded-2xl border bg-space/60 px-3 transition-colors ${asking ? "border-[#ff8c5a]/60" : "border-line focus-within:border-[#ff8c5a]/60"}`}>
          <Sparkles size={16} className={asking ? "text-[#ff8c5a] animate-pulse" : "text-[#ff8c5a]"} />
          <input value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Ask anything — “AI startups at seed from Armenia”"
            className="w-full bg-transparent py-2.5 text-sm text-ink outline-none placeholder:text-faint" />
          {q && !asking && (
            <button type="button" onClick={() => setQ("")} className="text-faint hover:text-ink"><XIcon size={14} /></button>
          )}
          <button type="submit" disabled={asking || q.trim().length < 3}
            className="shrink-0 rounded-xl px-3 py-1.5 text-[11px] font-bold transition disabled:opacity-40"
            style={{ background: "#ff8c5a", color: "#04121a" }}>
            {asking ? <Loader2 size={13} className="animate-spin" /> : "Ask"}
          </button>
        </div>
      </form>

      {trace && (
        <ConciergePanel trace={trace} answer={answer} answerDone={answerDone}
          onClose={closeConcierge} onOpen={(n) => onOpen({ node: n })} />
      )}

      <div className="flex flex-wrap gap-1.5">
        <Chip active={type === ""} onClick={() => setType("")}>All</Chip>
        {types.map((t) => <Chip key={t.id} active={type === t.id} onClick={() => setType(t.id)}>{t.label}</Chip>)}
      </div>
      {/* Facets — "Find AI startups", "founders from Armenia", "Seed stage" */}
      <div className="grid grid-cols-2 gap-1.5">
        <FacetSelect value={industry} onChange={setIndustry} placeholder="Industry" options={facetOptions.industry} cls={facetCls} />
        <FacetSelect value={tech} onChange={setTech} placeholder="Technology" options={facetOptions.tech} cls={facetCls} />
        <FacetSelect value={country} onChange={setCountry} placeholder="Country" options={facetOptions.country} cls={facetCls} />
        <FacetSelect value={stage} onChange={setStage} placeholder="Stage" options={facetOptions.stage} cls={facetCls} />
      </div>

      {rows && rows.length > 0 && (
        <div className="flex items-center justify-between px-0.5 pt-0.5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">
            {rows.length} {rows.length === 1 ? "result" : "results"}
          </span>
          {activeFacets > 0 && (
            <button type="button"
              onClick={() => { setType(""); setIndustry(""); setTech(""); setCountry(""); setStage(""); }}
              className="text-[11px] text-dim hover:text-ink">Clear filters</button>
          )}
        </div>
      )}
      {rows === null ? (
        <div className="space-y-2">{[0, 1, 2, 3].map((i) => <SkeletonRow key={i} />)}</div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 py-10 text-center">
          <Search className="text-faint" size={24} />
          <p className="text-sm text-dim">No one here yet.</p>
          <p className="text-xs text-faint">Try a broader question or clear the filters.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((n, i) => (
            <button key={n.id} type="button" onClick={() => onOpen({ node: n })}
              className="trace-in flex w-full items-center gap-3 rounded-xl border border-line bg-surface/60 p-3 text-left transition hover:border-[#ff8c5a]/40 hover:bg-surface"
              style={{ animationDelay: `${Math.min(i, 12) * 35}ms` }}>
              <Avatar node={n} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-ink">{n.label}</div>
                <div className="truncate text-xs text-dim">{n.sub}</div>
              </div>
              <ChevronRight size={15} className="shrink-0 text-faint" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* --------------------- concierge agent trace ----------------------- */

type StepId = "intent" | "search" | "answer";
interface ThinkStep {
  id: StepId;
  label: string;
  status: "pending" | "active" | "done" | "error";
  summary?: string;
}
interface AgentTrace {
  query: string;
  steps: ThinkStep[];
  intentChips: { k: string; v: string }[];
  found: GNode[];
}

const freshSteps = (): ThinkStep[] => [
  { id: "intent", label: "Understanding your question", status: "active" },
  { id: "search", label: "Searching people & entities", status: "pending" },
  { id: "answer", label: "Reading the graph & answering", status: "pending" },
];

/** Turn the AI's parsed filters into readable "intent" chips. */
function intentChips(
  filters: { type?: string; industry?: string; tech?: string; country?: string; stage?: string; skill?: string },
  types: ReturnType<typeof entityTypesForApp>,
): { k: string; v: string }[] {
  const out: { k: string; v: string }[] = [];
  if (filters.type) out.push({ k: "type", v: typeLabel(filters.type, types) });
  if (filters.industry) out.push({ k: "industry", v: filters.industry });
  if (filters.tech) out.push({ k: "tech", v: filters.tech });
  if (filters.country) out.push({ k: "country", v: filters.country });
  if (filters.stage) out.push({ k: "stage", v: filters.stage });
  if (filters.skill) out.push({ k: "skill", v: filters.skill });
  return out.map((c) => ({ ...c, v: c.v.replace(/_/g, " ") }));
}

const typeLabel = (id: string, types: ReturnType<typeof entityTypesForApp>): string =>
  types.find((t) => t.id === id)?.label ?? id.replace(/_/g, " ");

function countLabel(n: number, type: string | undefined, types: ReturnType<typeof entityTypesForApp>): string {
  const noun = type ? typeLabel(type, types).toLowerCase() : "match";
  const plural = n === 1 ? noun : noun.endsWith("s") ? noun : `${noun}s`;
  return `${n} ${plural}`;
}

function ConciergePanel({
  trace, answer, answerDone, onClose, onOpen,
}: {
  trace: AgentTrace;
  answer: string;
  answerDone: boolean;
  onClose: () => void;
  onOpen: (n: GNode) => void;
}) {
  return (
    <div className="trace-in overflow-hidden rounded-2xl border border-[#ff8c5a]/30 bg-gradient-to-b from-[#ff8c5a]/[0.07] to-transparent">
      <div className="flex items-center justify-between px-3.5 pt-3">
        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#ff8c5a]">
          <Sparkles size={12} /> Concierge
        </span>
        <button type="button" onClick={onClose} className="text-faint hover:text-ink"><XIcon size={13} /></button>
      </div>

      {/* Step-by-step thinking trace — each row reveals as its work begins */}
      <div className="mt-2 space-y-0.5 px-2.5">
        {trace.steps.map((s, i) => (
          <div key={s.id} className="trace-in" style={{ animationDelay: `${i * 70}ms` }}>
            <StepRow step={s} trace={trace} onOpen={onOpen} />
          </div>
        ))}
      </div>

      {/* Final concierge answer — streamed, Markdown-rendered */}
      {(answer || !answerDone) && (
        <div className="mt-2 border-t border-[#ff8c5a]/15 px-3.5 py-3 text-[13px] leading-relaxed text-ink">
          <MarkdownLite text={answer} />
          {!answerDone && <span className="ml-0.5 inline-block h-3.5 w-[7px] animate-pulse bg-[#ff8c5a] align-middle" />}
        </div>
      )}
    </div>
  );
}

const STEP_ICON: Record<StepId, typeof Target> = { intent: Target, search: Search, answer: Network };

function StepRow({ step, trace, onOpen }: { step: ThinkStep; trace: AgentTrace; onOpen: (n: GNode) => void }) {
  const [open, setOpen] = useState(false);
  const Icon = STEP_ICON[step.id];
  const hasDetail =
    (step.id === "intent" && trace.intentChips.length > 0) ||
    (step.id === "search" && trace.found.length > 0);
  const canToggle = hasDetail && step.status === "done";

  return (
    <div className="rounded-lg">
      <button type="button" disabled={!canToggle} onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left ${canToggle ? "hover:bg-[#ff8c5a]/[0.06]" : ""}`}>
        {/* status glyph */}
        <span className="grid h-5 w-5 shrink-0 place-items-center">
          {step.status === "active" ? <Loader2 size={13} className="animate-spin text-[#ff8c5a]" />
            : step.status === "done" ? <Check size={13} className="text-[#9af0c8]" />
            : step.status === "error" ? <AlertCircle size={13} className="text-rose-300" />
            : <span className="h-1.5 w-1.5 rounded-full bg-faint" />}
        </span>
        <Icon size={13} className={step.status === "pending" ? "text-faint" : "text-dim"} />
        <span className={`flex-1 truncate text-[12.5px] ${step.status === "pending" ? "text-faint" : "text-ink"}`}>
          {step.label}
          {step.summary && <span className="ml-1.5 text-dim">· {step.summary}</span>}
        </span>
        {canToggle && (
          <ChevronRight size={14} className={`shrink-0 text-faint transition-transform ${open ? "rotate-90" : ""}`} />
        )}
      </button>

      {open && step.id === "intent" && (
        <div className="flex flex-wrap gap-1.5 px-8 pb-2 pt-0.5">
          {trace.intentChips.map((c) => (
            <span key={c.k} className="rounded-md border border-[#ff8c5a]/30 bg-[#ff8c5a]/10 px-2 py-0.5 text-[11px] capitalize text-[#ffb98c]">
              <span className="text-[#ff8c5a]/70">{c.k}:</span> {c.v}
            </span>
          ))}
        </div>
      )}
      {open && step.id === "search" && (
        <div className="space-y-1 px-8 pb-2 pt-0.5">
          {trace.found.slice(0, 8).map((n, i) => (
            <button key={n.id} type="button" onClick={() => onOpen(n)}
              className="trace-in flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-[#ff8c5a]/[0.06]"
              style={{ animationDelay: `${i * 45}ms` }}>
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold"
                style={{ background: "rgba(255,140,90,0.18)", color: "#ffb98c" }}>
                {n.label.charAt(0).toUpperCase()}
              </span>
              <span className="truncate text-[12px] text-ink">{n.label}</span>
              {n.entityType && <span className="ml-auto shrink-0 text-[10px] capitalize text-faint">{String(n.entityType).replace(/_/g, " ")}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Shimmer placeholder while results load. */
function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-surface/40 p-3">
      <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-line/60" />
      <div className="flex-1 space-y-1.5">
        <div className="h-3 w-1/3 animate-pulse rounded bg-line/60" />
        <div className="h-2.5 w-1/2 animate-pulse rounded bg-line/40" />
      </div>
    </div>
  );
}

/**
 * A light, non-creepy read of the viewer for the concierge — their role,
 * a few skills, sectors, and their venture (from their own profile only).
 */
function viewerContext(me: GNode | null): ViewerContext | undefined {
  if (!me) return undefined;
  const p = me.properties ?? {};
  const arr = (k: string) => (Array.isArray(p[k]) ? (p[k] as unknown[]).map(String) : []);
  const skills = [...arr("skills_offered"), ...arr("expertise"), ...arr("skills")];
  const sectors = [...arr("sectors"), ...arr("industries"), ...arr("interests")];
  const venture = ["company", "startup", "venture", "organization"]
    .map((k) => (typeof p[k] === "string" ? (p[k] as string) : "")).find(Boolean);
  const roles = Array.isArray(p.active_roles) ? (p.active_roles as unknown[]).map(String) : [];
  const role = roles[0] ?? me.entityType ?? undefined;
  const ctx: ViewerContext = {};
  if (role) ctx.role = String(role).replace(/_/g, " ");
  if (skills.length) ctx.skills = [...new Set(skills)].slice(0, 5);
  if (sectors.length) ctx.sectors = [...new Set(sectors)].slice(0, 3);
  if (venture) ctx.venture = venture;
  return Object.keys(ctx).length ? ctx : undefined;
}

/** Inline Markdown: **bold** and *italic* / _italic_ → real elements (safe, no HTML). */
function renderInline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_)/g;
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const bold = m[2] ?? m[3];
    if (bold != null) out.push(<strong key={`${keyBase}${i}`} className="font-semibold text-ink">{bold}</strong>);
    else out.push(<em key={`${keyBase}${i}`}>{m[4] ?? m[5]}</em>);
    last = m.index + m[0].length;
    i++;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Minimal Markdown block renderer — paragraphs + `- ` bullet lists. */
function MarkdownLite({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (!bullets.length) return;
    const items = bullets;
    const key = `ul${blocks.length}`;
    blocks.push(
      <ul key={key} className="my-1 list-disc space-y-0.5 pl-4 marker:text-[#ff8c5a]">
        {items.map((li, i) => <li key={i}>{renderInline(li, `${key}-${i}-`)}</li>)}
      </ul>,
    );
    bullets = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const bul = line.match(/^\s*[-*]\s+(.*)$/);
    if (bul) { bullets.push(bul[1]); continue; }
    flush();
    if (line.trim()) blocks.push(<p key={`p${blocks.length}`} className="mb-1.5 last:mb-0">{renderInline(line, `p${blocks.length}-`)}</p>);
  }
  flush();
  return <>{blocks}</>;
}

const STAGE_LABEL: Record<string, string> = {
  discovered: "Discovered", interested: "Interested", met: "Met", conversation: "Conversation",
  follow_up: "Follow-up", opportunity: "Opportunity", pilot: "Pilot", partnership: "Partnership",
  long_term: "Long-term", trust: "Trust",
};

function Contacts({ onOpen, version }: { onOpen: (t: OpenTarget) => void; version: number }) {
  const [items, setItems] = useState<ContactItem[] | null>(null);
  const [stepperFor, setStepperFor] = useState<string | null>(null);
  const [bump, setBump] = useState(0);
  useEffect(() => { getContactItems().then(setItems).catch(() => setItems([])); }, [version, bump]);

  const advance = async (id: string, stage: string) => {
    await setContactStage(id, stage).catch(() => {});
    setStepperFor(null);
    setBump((b) => b + 1);
  };

  const exportCsv = () => {
    const list = items ?? [];
    const header = "Name,Role,Label,Stage,Details\n";
    const body = list.map((it) =>
      `"${it.node.label}","${it.node.entityType ?? ""}","${it.label}","${it.stage}","${(it.node.sub ?? "").replace(/"/g, "'")}"`,
    ).join("\n");
    download("sevan-contacts.csv", "text/csv", header + body);
  };
  const exportVcf = () => {
    const list = items ?? [];
    const vcf = list.map((it) =>
      `BEGIN:VCARD\nVERSION:3.0\nFN:${it.node.label}\nTITLE:${it.node.entityType ?? ""}\nNOTE:${it.label.replace(/_/g, " ")} · ${(it.node.sub ?? "").replace(/\n/g, " ")}\nEND:VCARD`,
    ).join("\n");
    download("sevan-contacts.vcf", "text/vcard", vcf);
  };

  // Grouped by bookmark tag (F6) — a contact with several tags appears in each.
  const groups = CONTACT_LABELS
    .map((l) => ({ ...l, rows: (items ?? []).filter((it) => (it.labels?.length ? it.labels : [it.label]).includes(l.id)) }))
    .filter((g) => g.rows.length > 0);

  return (
    <div className="space-y-4 pt-1">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-ink" style={{ fontFamily: "var(--font-display)" }}>Saved contacts</h2>
        {(items?.length ?? 0) > 0 && (
          <div className="flex gap-1.5">
            <button type="button" onClick={exportVcf} className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-xs text-dim"><Download size={12} /> vCard</button>
            <button type="button" onClick={exportCsv} className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-xs text-dim"><Download size={12} /> CSV</button>
          </div>
        )}
      </div>
      {items === null ? (
        <div className="flex justify-center py-8 text-dim"><Loader2 className="animate-spin" size={18} /></div>
      ) : items.length === 0 ? (
        <p className="py-6 text-center text-sm text-faint">Save people you meet — they’ll show here for follow-up.</p>
      ) : (
        groups.map((g) => (
          <section key={g.id}>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-faint">{g.label}</div>
            <div className="space-y-2">
              {g.rows.map((it) => (
                <div key={it.node.id} className="rounded-xl border border-line bg-surface/60 p-3">
                  <div className="flex items-center gap-3">
                    <button type="button" onClick={() => onOpen({ node: it.node })} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                      <Avatar node={it.node} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-ink">{it.node.label}</div>
                        <div className="truncate text-xs text-dim">{it.node.sub}</div>
                      </div>
                    </button>
                    {/* Lifecycle stage pill — tap to advance (trust = final stage) */}
                    <button
                      type="button"
                      onClick={() => setStepperFor(stepperFor === it.node.id ? null : it.node.id)}
                      className="shrink-0 rounded-full px-2.5 py-1 text-[10.5px] font-semibold"
                      style={it.stage === "trust"
                        ? { background: "rgba(255,140,90,0.2)", color: "#ff8c5a" }
                        : { background: "rgba(124,150,255,0.14)", color: "#a9bcff" }}
                    >
                      {STAGE_LABEL[it.stage] ?? it.stage}
                    </button>
                  </div>
                  {stepperFor === it.node.id && (
                    <div className="mt-2 flex flex-wrap gap-1 border-t border-line pt-2">
                      {LIFECYCLE_STAGES.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => void advance(it.node.id, s)}
                          className="rounded-full border px-2 py-0.5 text-[10.5px]"
                          style={s === it.stage
                            ? { borderColor: "rgba(255,140,90,0.6)", color: "#ff8c5a" }
                            : { borderColor: "var(--color-line)", color: "var(--color-faint)" }}
                        >
                          {STAGE_LABEL[s]}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

function Schedule() {
  const [data, setData] = useState<{ incoming: Meeting[]; outgoing: Meeting[] } | null>(null);
  const [intros, setIntros] = useState<MyAsk[]>([]);
  const [inbox, setInbox] = useState<InboxAsk[]>([]);
  const [programme, setProgramme] = useState<ProgrammeItem[]>([]);
  const load = useCallback(() => {
    getMeetings().then(setData).catch(() => setData({ incoming: [], outgoing: [] }));
    myAsks(SUMMIT_APP).then(setIntros).catch(() => setIntros([]));
    askInbox(SUMMIT_APP).then(setInbox).catch(() => setInbox([]));
    getProgramme().then(setProgramme).catch(() => setProgramme([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  const toggleAttend = async (it: ProgrammeItem) => {
    await setAttending(it.node.id, it.attending).catch(() => {});
    load();
  };

  const [respondErr, setRespondErr] = useState<string | null>(null);
  const respond = async (id: string, action: "confirm" | "decline") => {
    setRespondErr(null);
    try {
      await respondMeeting(id, action);
    } catch (e) {
      setRespondErr(e instanceof Error ? e.message : "could not update the meeting");
    }
    load();
  };

  if (!data) return <div className="flex justify-center py-10 text-dim"><Loader2 className="animate-spin" size={18} /></div>;
  const noMeetings = data.incoming.length === 0 && data.outgoing.length === 0 && intros.length === 0;
  if (noMeetings && programme.length === 0 && inbox.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
        <Calendar className="text-faint" size={26} />
        <p className="text-sm text-dim">No meetings or intros yet.</p>
        <p className="text-xs text-faint">Open anyone’s profile to request a 1:1 or an intro.</p>
      </div>
    );
  }
  const badge = (s: string) => (
    <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={s === "confirmed" ? { background: "rgba(154,240,200,0.16)", color: "#9af0c8" }
        : s === "declined" ? { background: "rgba(255,120,120,0.14)", color: "#ff9a9a" }
        : { background: "rgba(255,217,122,0.14)", color: "#ffd97a" }}>{s}</span>
  );

  return (
    <div className="space-y-4 pt-1">
      {respondErr && (
        <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{respondErr}</p>
      )}
      {inbox.length > 0 && (
        <section>
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-faint">
            <Handshake size={13} /> Your network needs help
          </div>
          <div className="space-y-2">
            {inbox.map((a) => (
              <AskInboxCard key={a.id} ask={a} onDone={load} />
            ))}
          </div>
        </section>
      )}
      {programme.length > 0 && (
        <section>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-faint">Programme</div>
          <div className="space-y-2">
            {programme.map((it) => {
              const p = it.node.properties ?? {};
              return (
                <div key={it.node.id} className="flex items-center gap-3 rounded-xl border border-line bg-surface/60 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-ink">{it.node.label}</div>
                    <div className="truncate text-xs text-dim">
                      {[p.time, String(p.track ?? "").replace(/_/g, " ")].filter(Boolean).join(" · ")}
                      {it.attendees > 0 && ` · ${it.attendees} attending`}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void toggleAttend(it)}
                    className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold"
                    style={it.attending
                      ? { background: "rgba(154,240,200,0.16)", color: "#9af0c8" }
                      : { background: "rgba(255,140,90,0.14)", color: "#ff8c5a" }}
                  >
                    {it.attending ? "Attending ✓" : "Attend"}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}
      {data.incoming.length > 0 && (
        <section>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-faint">Requests to you</div>
          <div className="space-y-2">
            {data.incoming.map((m) => (
              <div key={m.id} className="rounded-xl border border-line bg-surface/60 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-ink">{m.requesterLabel}</span>
                  {badge(m.status)}
                </div>
                <div className="mt-0.5 text-xs text-dim">
                  {[m.kind.replace(/_/g, " "), formatSlot(m.slot), m.location].filter(Boolean).join(" · ")}
                </div>
                {m.note && <div className="mt-1 text-xs text-faint">“{m.note}”</div>}
                {m.status === "requested" && (
                  <div className="mt-2 flex gap-2">
                    <button type="button" onClick={() => respond(m.id, "confirm")}
                      className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-[#9af0c8] py-1.5 text-xs font-semibold text-[#04121a]"><Check size={13} /> Confirm</button>
                    <button type="button" onClick={() => respond(m.id, "decline")}
                      className="flex items-center justify-center gap-1 rounded-lg border border-line px-3 py-1.5 text-xs text-dim"><XIcon size={13} /> Decline</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
      {data.outgoing.length > 0 && (
        <section>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-faint">Your meeting requests</div>
          <div className="space-y-2">
            {data.outgoing.map((m) => (
              <div key={m.id} className="flex items-center justify-between rounded-xl border border-line bg-surface/60 p-3">
                <div>
                  <div className="text-sm font-semibold text-ink">{m.targetLabel}</div>
                  <div className="text-xs text-dim">
                    {[m.kind.replace(/_/g, " "), formatSlot(m.slot), m.location].filter(Boolean).join(" · ")}
                  </div>
                </div>
                {badge(m.status)}
              </div>
            ))}
          </div>
        </section>
      )}
      {intros.length > 0 && (
        <section>
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-faint">
            <Handshake size={13} /> Your intro requests
          </div>
          <div className="space-y-2">
            {intros.map((a) => (
              <div key={a.id} className="rounded-xl border border-line bg-surface/60 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-ink">{a.note || `Intro on ${a.topic}`}</span>
                  {badge(a.answers.length > 0 ? "confirmed" : "requested")}
                </div>
                {a.answers.length > 0 && (
                  <div className="mt-1 text-xs text-[#9af0c8]">
                    {a.answers.map((ans) => `${ans.responderName} → ${ans.providerLabel}`).join(" · ")}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * One answerable ask from your network. Respond by recommending ANY entity
 * (person, startup, mentor…) you search the directory for, or — if the right
 * person isn't here yet — mint an invite link to bring them in.
 */
function AskInboxCard({ ask, onDone }: { ask: InboxAsk; onDone: () => void }) {
  const [mode, setMode] = useState<"idle" | "recommend" | "invite">("idle");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<GNode[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [doneMsg, setDoneMsg] = useState<string | null>(null);
  const [invite, setInvite] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Debounced directory search across every entity type in the summit space.
  useEffect(() => {
    if (mode !== "recommend") return;
    const term = q.trim();
    if (term.length < 2) { setResults([]); return; }
    let alive = true;
    setSearching(true);
    const t = setTimeout(() => {
      getDirectoryFiltered({ q: term })
        .then((r) => { if (alive) setResults(r.nodes.slice(0, 8)); })
        .catch(() => { if (alive) setResults([]); })
        .finally(() => { if (alive) setSearching(false); });
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [q, mode]);

  const recommend = async (node: GNode) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await answerAsk(ask.id, { nodeId: node.id }, SUMMIT_APP);
      if (r.ok) {
        setDoneMsg(`Recommended ${node.label} to ${ask.askerName}`);
        setTimeout(onDone, 1200);
      } else {
        setDoneMsg(r.reason === "self" ? "That's your own ask." : "This ask is no longer open.");
      }
    } catch {
      setDoneMsg("Couldn't send that recommendation.");
    } finally {
      setBusy(false);
    }
  };

  const doInvite = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { code } = await createInvite(`Intro for ${ask.askerName}${ask.note ? ` — ${ask.note}` : ""}`);
      setInvite(inviteUrl(code));
    } catch {
      setDoneMsg("Couldn't create an invite link.");
    } finally {
      setBusy(false);
    }
  };

  const copyInvite = async () => {
    if (!invite) return;
    try { await navigator.clipboard.writeText(invite); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* noop */ }
  };

  return (
    <div className="rounded-xl border border-line bg-surface/60 p-3">
      <div className="text-sm text-ink">
        <span className="font-semibold">{ask.askerName}</span>{" "}
        <span className="text-dim">{ask.note || `is looking for help with ${ask.topic}`}</span>
      </div>
      {doneMsg ? (
        <div className="mt-2 text-xs font-medium text-[#9af0c8]">{doneMsg}</div>
      ) : invite ? (
        <div className="mt-2 space-y-1.5">
          <p className="text-xs text-dim">Share this link to bring them to Sevan:</p>
          <div className="flex items-center gap-1.5">
            <input readOnly value={invite}
              className="min-w-0 flex-1 truncate rounded-lg border border-line bg-space/60 px-2 py-1.5 text-[11px] text-dim" />
            <button type="button" onClick={copyInvite}
              className="flex shrink-0 items-center gap-1 rounded-lg bg-[#9af0c8] px-2.5 py-1.5 text-xs font-semibold text-[#04121a]">
              <Copy size={12} /> {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      ) : mode === "idle" ? (
        <div className="mt-2 flex gap-2">
          <button type="button" onClick={() => setMode("recommend")}
            className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-[#ff8c5a] py-1.5 text-xs font-semibold text-[#04121a]">
            <Handshake size={13} /> Recommend someone
          </button>
          <button type="button" onClick={() => { setMode("invite"); void doInvite(); }} disabled={busy}
            className="flex items-center justify-center gap-1 rounded-lg border border-line px-3 py-1.5 text-xs text-dim">
            <UserPlus size={13} /> Invite
          </button>
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          <div className="flex items-center gap-1.5 rounded-lg border border-line bg-space/60 px-2">
            <Search size={13} className="text-faint" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Search people & entities…"
              className="w-full bg-transparent py-1.5 text-sm text-ink outline-none placeholder:text-faint" />
            <button type="button" onClick={() => { setMode("idle"); setQ(""); }}
              className="text-faint hover:text-ink"><XIcon size={13} /></button>
          </div>
          {searching ? (
            <div className="flex justify-center py-2 text-dim"><Loader2 className="animate-spin" size={14} /></div>
          ) : results.length > 0 ? (
            <div className="space-y-1">
              {results.map((n) => (
                <button key={n.id} type="button" disabled={busy} onClick={() => void recommend(n)}
                  className="flex w-full items-center gap-2 rounded-lg border border-line/60 bg-space/40 px-2 py-1.5 text-left hover:border-[#ff8c5a]/50">
                  <Avatar node={n} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-ink">{n.label}</div>
                    <div className="truncate text-[11px] text-faint">
                      {String(n.entityType ?? n.type ?? "").replace(/_/g, " ")}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ) : q.trim().length >= 2 ? (
            <p className="py-1.5 text-center text-[11px] text-faint">
              No match — <button type="button" className="text-[#9af0c8] underline" onClick={() => { setMode("invite"); void doInvite(); }}>invite them instead</button>.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

/* ------------------------------ atoms ------------------------------- */

function Avatar({ node }: { node: GNode }) {
  const isOrg = node.type === "location";
  return (
    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-bold"
      style={isOrg ? { background: "rgba(227,200,75,0.18)", color: "#e3c84b" } : { background: "rgba(124,150,255,0.18)", color: "#a9bcff" }}>
      {node.label.charAt(0).toUpperCase()}
    </div>
  );
}

/** My notes journal — everything you captured, editable, across all people. */
function MyNotesJournal() {
  const [notes, setNotes] = useState<MyNote[] | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<MyNote | null>(null);
  const load = useCallback(() => { getMyNotes().then(setNotes).catch(() => setNotes([])); }, []);
  useEffect(() => { if (open && notes === null) load(); }, [open, notes, load]);

  const remove = async (id: string) => {
    if (!confirm("Delete this note? Its graph connections are removed too.")) return;
    await deleteNoteApi(id).catch(() => {});
    load();
  };
  const glyph = (v: string) =>
    v === "public" ? <Globe size={10} /> : v === "connections" ? <UsersIcon size={10} /> : <Lock size={10} />;

  return (
    <div className="mb-4">
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-line py-3 text-sm font-semibold text-ink hover:border-[#ff8c5a]/50">
        <NotebookPen size={16} className="text-[#ff8c5a]" /> My notes {notes ? `(${notes.length})` : ""}
      </button>
      {open && (
        <div className="mt-2 space-y-1.5">
          {notes === null ? (
            <div className="flex justify-center py-4 text-dim"><Loader2 className="animate-spin" size={15} /></div>
          ) : notes.length === 0 ? (
            <p className="py-3 text-center text-xs text-faint">No notes yet — open someone’s profile to add one.</p>
          ) : (
            notes.map((n) => (
              <div key={n.id} className="rounded-lg border border-line/60 bg-space/40 px-2.5 py-2">
                <div className="flex items-center gap-1.5 text-[10.5px] text-faint">
                  {glyph(n.visibility)}
                  <span className="font-semibold text-dim">{n.targetLabel}</span>
                  <span className="ml-auto flex gap-2">
                    <button type="button" onClick={() => setEditing(n)} className="inline-flex items-center gap-0.5 hover:text-ink">
                      <Pencil size={10} /> edit
                    </button>
                    <button type="button" onClick={() => void remove(n.id)} className="inline-flex items-center gap-0.5 hover:text-rose-300">
                      <Trash2 size={10} /> delete
                    </button>
                  </span>
                </div>
                <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-dim">{n.text}</p>
              </div>
            ))
          )}
        </div>
      )}
      {editing && (
        <NoteComposer
          target={{ id: editing.targetId, label: editing.targetLabel }}
          edit={editing}
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}

/** Profile completeness (F1) — better profiles ⇒ better matches. Counts the
 *  UNION of the person's active roles' fields (deduped by key). */
function CompletenessMeter({ node }: { node: GNode }) {
  const defs = entityTypesForApp(SUMMIT_APP).filter((t) => hasRole(node, t.id));
  const fields = [...new Map(defs.flatMap((d) => d.fields).map((f) => [f.key, f])).values()];
  if (fields.length === 0) return null;
  const p = node.properties ?? {};
  const empty = (v: unknown) => v == null || v === "" || (Array.isArray(v) && v.length === 0);
  const filled = fields.filter((f) => !empty(p[f.key])).length;
  const pct = Math.round((100 * filled) / fields.length);
  if (pct >= 100) return null;
  const missing = fields.find((f) => empty(p[f.key]) && f.type === "multiselect");
  return (
    <div className="mb-3 rounded-xl border border-line bg-surface/60 p-3">
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-semibold uppercase tracking-[0.14em] text-faint">Profile {pct}% complete</span>
        {missing && <span className="text-dim">add {missing.label.toLowerCase()} → better matches</span>}
      </div>
      <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full" style={{ background: "rgba(146,166,255,0.14)" }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "#9af0c8" }} />
      </div>
    </div>
  );
}

function FacetSelect({ value, onChange, placeholder, options, cls }: {
  value: string; onChange: (v: string) => void; placeholder: string; options: string[]; cls: string;
}) {
  if (options.length === 0) return null;
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={cls}
      style={value ? { borderColor: "rgba(255,140,90,0.5)", color: "var(--color-ink)" } : { color: "var(--color-faint)" }}>
      <option value="">{placeholder}</option>
      {options.map((o) => <option key={o} value={o}>{o.replace(/_/g, " ")}</option>)}
    </select>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="rounded-full border px-3 py-1 text-[12px]"
      style={active ? { borderColor: "rgba(255,140,90,0.6)", background: "rgba(255,140,90,0.12)", color: "var(--color-ink)" } : { borderColor: "var(--color-line)", color: "var(--color-dim)" }}>
      {children}
    </button>
  );
}

function download(name: string, type: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
