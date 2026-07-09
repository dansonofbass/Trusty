"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { entityTypesForApp, hasRole, type GNode } from "@constellation/graph-core";
import { hydrateOntology } from "@/lib/ontologyClient";
import {
  getMyProfile, getDirectoryFiltered, getContacts, getContactItems, setContactStage,
  getMeetings, respondMeeting, getProgramme, setAttending, formatSlot,
  getMyNotes, deleteNoteApi, resolveSevanQuery, streamSevanAnswer,
  CONTACT_LABELS, LIFECYCLE_STAGES,
  SUMMIT_APP, type Meeting, type ContactItem, type ProgrammeItem, type MyNote,
} from "@/lib/summitClient";
import { myAsks, type MyAsk } from "@/lib/asksClient";
import ProfileCard from "./ProfileCard";
import ProfileEditor from "./ProfileEditor";
import Home from "./Home";
import NoteComposer from "./NoteComposer";
import { QRShare, QRScan, QRButtons } from "./QRConnect";
import {
  Compass, BookOpen, Calendar, Bookmark, User, Loader2, Download, Sparkles,
  Check, X as XIcon, Handshake, Lock, Users as UsersIcon, Globe, Pencil, Trash2, NotebookPen,
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
        {tab === "directory" && <Directory onOpen={setSelected} />}
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

function Directory({ onOpen }: { onOpen: (t: OpenTarget) => void }) {
  const types = useMemo(() => entityTypesForApp(SUMMIT_APP), []);
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

  /* Agent search: NL query → AI-built filters → results → streamed answer. */
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [answerDone, setAnswerDone] = useState(true);
  const ask = async () => {
    const query = q.trim();
    if (query.length < 3 || asking) return;
    setAsking(true);
    setAnswer("");
    setAnswerDone(false);
    try {
      const vocab = {
        types: types.map((t) => t.id),
        industry: facetOptions.industry,
        tech: facetOptions.tech,
        country: facetOptions.country,
        stage: facetOptions.stage,
        skill: [...new Set(types.flatMap((t) => t.fields.filter((f) => ["skills_offered", "expertise"].includes(f.key)).flatMap((f) => f.options ?? [])))],
      };
      const { filters } = await resolveSevanQuery(query, vocab);
      // Show the AI's query as live facet chips + load the matching rows.
      setType(filters.type ?? "");
      setIndustry(filters.industry ?? "");
      setTech(filters.tech ?? "");
      setCountry(filters.country ?? "");
      setStage(filters.stage ?? "");
      setQ("");
      const found = (await getDirectoryFiltered({
        type: filters.type, industry: filters.industry, tech: filters.tech,
        country: filters.country, stage: filters.stage, skill: filters.skill,
      })).nodes;
      setRows(found);
      await streamSevanAnswer(
        query,
        found.slice(0, 8).map((n) => ({ label: n.label, entityType: n.entityType, sub: n.sub })),
        (t) => setAnswer((a) => (a ?? "") + t),
      );
    } catch (e) {
      setAnswer(e instanceof Error ? `Search assistant unavailable — ${e.message}` : "Search assistant unavailable.");
    } finally {
      setAnswerDone(true);
      setAsking(false);
    }
  };

  const facetCls = "min-w-0 flex-1 rounded-lg border border-line bg-space/60 px-2 py-1.5 text-[12px] text-ink outline-none";

  return (
    <div className="space-y-3 pt-1">
      <form onSubmit={(e) => { e.preventDefault(); void ask(); }} className="relative">
        <input value={q} onChange={(e) => setQ(e.target.value)}
          placeholder={`Ask the directory… "find AI startups at seed"`}
          className="w-full rounded-xl border border-line bg-space/60 py-2.5 pl-3 pr-16 text-sm text-ink outline-none focus:border-gold/60" />
        <button type="submit" disabled={asking || q.trim().length < 3}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg px-2.5 py-1.5 text-[11px] font-bold disabled:opacity-40"
          style={{ background: "#ff8c5a", color: "#04121a" }}>
          {asking ? "…" : "✦ Ask"}
        </button>
      </form>

      {answer !== null && (
        <div className="rounded-xl border border-[#ff8c5a]/30 bg-[#ff8c5a]/5 px-3.5 py-3">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#ff8c5a]">✦ Concierge</span>
            <button type="button" onClick={() => setAnswer(null)} className="text-faint hover:text-ink"><XIcon size={12} /></button>
          </div>
          <p className="text-[13px] leading-relaxed text-ink">
            {answer}
            {!answerDone && <span className="ml-0.5 inline-block h-3.5 w-[7px] animate-pulse bg-[#ff8c5a]" />}
          </p>
        </div>
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
      {rows === null ? (
        <div className="flex justify-center py-8 text-dim"><Loader2 className="animate-spin" size={18} /></div>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-faint">No one here yet.</p>
      ) : (
        rows.map((n) => (
          <button key={n.id} type="button" onClick={() => onOpen({ node: n })}
            className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface/60 p-3 text-left">
            <Avatar node={n} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-ink">{n.label}</div>
              <div className="truncate text-xs text-dim">{n.sub}</div>
            </div>
          </button>
        ))
      )}
    </div>
  );
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

  // Grouped by bookmark label (F6) — groups appear in labelled order.
  const groups = CONTACT_LABELS
    .map((l) => ({ ...l, rows: (items ?? []).filter((it) => it.label === l.id) }))
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
  const [programme, setProgramme] = useState<ProgrammeItem[]>([]);
  const load = useCallback(() => {
    getMeetings().then(setData).catch(() => setData({ incoming: [], outgoing: [] }));
    myAsks().then(setIntros).catch(() => setIntros([]));
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
  if (noMeetings && programme.length === 0) {
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

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
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
