"use client";

import { useCallback, useEffect, useState } from "react";
import { Megaphone, Send, Loader2, Check, Search, UserPlus, Copy, Type } from "lucide-react";
import type { GNode } from "@constellation/graph-core";
import { TRUST_ACCENT, withAlpha } from "@/lib/palette";
import { answerAsk, askInbox, myAsks, type InboxAsk, type MyAsk } from "@/lib/asksClient";
import { searchShared } from "@/lib/trustClient";
import { createInvite, inviteUrl } from "@/lib/inviteClient";
import { useUI } from "@/lib/store";
import PanelShell from "./dock/PanelShell";

/**
 * Ask-my-network surface. Two halves of the loop:
 *  - "Asks for you": open asks from friends → naming a provider creates YOUR
 *    trust edge (and answers them), turning a friend's dead-end into a real edge.
 *  - "Your asks": what you broadcast + who answered (which now surfaces in your
 *    trust search through the friend bridge).
 * The FAB badge nudges friends to answer — that's where the edges come from.
 */
export default function AsksPanel({
  variant = "standalone",
}: {
  /** "docked": no FAB, driven by the ActionDock's rightPanel store (desktop).
   *  "standalone": own FAB + local state (mobile /m — unchanged). */
  variant?: "standalone" | "docked";
}) {
  const docked = variant === "docked";
  const [localOpen, setLocalOpen] = useState(false);
  const rightPanel = useUI((s) => s.rightPanel);
  const setRightPanel = useUI((s) => s.setRightPanel);
  const open = docked ? rightPanel === "asks" : localOpen;
  const setOpen = (v: boolean) => (docked ? setRightPanel(v ? "asks" : null) : setLocalOpen(v));
  const [inbox, setInbox] = useState<InboxAsk[]>([]);
  const [mine, setMine] = useState<MyAsk[]>([]);
  const [loading, setLoading] = useState(false);
  const [count, setCount] = useState(0);

  useEffect(() => {
    askInbox()
      .then((a) => setCount(a.length))
      .catch(() => undefined);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [i, m] = await Promise.all([askInbox(), myAsks()]);
      setInbox(i);
      setMine(m);
      setCount(i.length);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const body = (
    <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
            {loading && inbox.length === 0 && mine.length === 0 && (
              <p className="text-sm text-dim">Loading…</p>
            )}

            <Section title={`Asks for you${inbox.length ? ` · ${inbox.length}` : ""}`}>
              {inbox.length === 0 ? (
                <Empty>No open asks from your friends right now.</Empty>
              ) : (
                inbox.map((a) => <InboxCard key={a.id} ask={a} onAnswered={refresh} />)
              )}
            </Section>

            <Section title="Your asks">
              {mine.length === 0 ? (
                <Empty>When a search finds nothing, broadcast it — it&apos;ll show here.</Empty>
              ) : (
                mine.map((a) => <MyAskCard key={a.id} ask={a} />)
              )}
            </Section>
    </div>
  );

  if (docked) {
    if (!open) return null;
    return (
      <PanelShell title="Ask your network" icon={<Megaphone size={15} />} onClose={() => setOpen(false)}>
        {body}
      </PanelShell>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="fixed bottom-[76px] right-6 z-40 flex items-center gap-2 rounded-full border border-line bg-surface px-4 py-2 text-sm font-semibold text-ink shadow-lg backdrop-blur-md hover:border-[var(--color-accent-line)]"
        style={{ fontFamily: "var(--font-display)", borderColor: open ? withAlpha(TRUST_ACCENT, 0.6) : undefined }}
      >
        <Megaphone size={15} /> Asks
        {count > 0 && (
          <span
            className="grid h-5 min-w-5 place-items-center rounded-full px-1 text-[11px] font-bold text-space"
            style={{ background: TRUST_ACCENT }}
          >
            {count}
          </span>
        )}
      </button>

      {open && (
        <aside className="pointer-events-auto fixed bottom-4 right-4 top-20 z-40 flex w-[380px] max-w-[calc(100vw-2rem)] flex-col rounded-2xl border border-line bg-nebula/95 shadow-2xl backdrop-blur-md">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-[15px] font-extrabold text-ink" style={{ fontFamily: "var(--font-display)" }}>
              Ask your network
            </h2>
            <button type="button" onClick={() => setOpen(false)} className="text-dim hover:text-ink">
              ✕
            </button>
          </div>
          {body}
        </aside>
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-4">
      <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-faint">{title}</div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-line bg-space/40 p-3 text-[12.5px] text-dim">{children}</div>;
}

/**
 * Answer a friend's ask — three ways, mirroring the Sevan flow:
 *  · Search: recommend someone already in the graph (pick a node)
 *  · Name:   type a provider (found-or-created), the classic path
 *  · Invite: they're not here yet → mint a shareable invite link
 * Search & Name both create YOUR trust edge on the topic (the edge = the answer).
 */
function InboxCard({ ask, onAnswered }: { ask: InboxAsk; onAnswered: () => void }) {
  const topicLabel = ask.topic.replace(/_/g, " ");
  const [mode, setMode] = useState<"search" | "name" | "invite">("search");
  const [name, setName] = useState("");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<GNode[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [invite, setInvite] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Debounced directory search for the "recommend an existing node" path.
  useEffect(() => {
    if (mode !== "search") return;
    const term = q.trim();
    if (term.length < 2) { setResults([]); return; }
    let alive = true;
    setSearching(true);
    const t = setTimeout(() => {
      searchShared(term)
        // Answering an ask names a person/place/provider — thoughts, posts and
        // other knowledge nodes aren't recommendable targets.
        .then((ns) => {
          if (alive)
            setResults(
              ns.filter((n) => n.type === "person" || n.type === "location" || !!n.entityType).slice(0, 6),
            );
        })
        .catch(() => { if (alive) setResults([]); })
        .finally(() => { if (alive) setSearching(false); });
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [q, mode]);

  const answer = async (input: { nodeId?: string; label?: string }, okMsg: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await answerAsk(ask.id, input);
      if (r.ok) { setDone(okMsg); setTimeout(onAnswered, 1100); }
      else setDone(r.reason === "self" ? "That's your own ask." : "This ask is no longer open.");
    } catch {
      setDone("Couldn't send that.");
    } finally {
      setBusy(false);
    }
  };

  const doInvite = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { code } = await createInvite(`For ${ask.askerName}: a ${topicLabel}${ask.geo ? ` in ${ask.geo}` : ""}`);
      setInvite(inviteUrl(code));
    } catch {
      setDone("Couldn't create an invite link.");
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    if (!invite) return;
    try { await navigator.clipboard.writeText(invite); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* noop */ }
  };

  const TabBtn = ({ id, icon, label }: { id: typeof mode; icon: React.ReactNode; label: string }) => (
    <button type="button" onClick={() => setMode(id)}
      className="flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold"
      style={mode === id ? { background: withAlpha(TRUST_ACCENT, 0.16), color: TRUST_ACCENT } : { color: "var(--color-faint)" }}>
      {icon} {label}
    </button>
  );

  return (
    <div className="rounded-xl border border-line bg-space/40 p-3">
      <p className="text-[13px] text-ink">
        <b>{ask.askerName}</b> is looking for a{" "}
        <b style={{ color: TRUST_ACCENT }}>{topicLabel}</b>
        {ask.geo ? ` in ${ask.geo}` : ""}.
      </p>
      {ask.note && <p className="mt-1 text-[12px] italic text-dim">“{ask.note}”</p>}

      {done ? (
        <p className="mt-2 flex items-center gap-1.5 text-[12.5px]" style={{ color: TRUST_ACCENT }}>
          <Check size={14} /> {done}
        </p>
      ) : invite ? (
        <div className="mt-2 space-y-1.5">
          <p className="text-[11.5px] text-dim">Share this link to bring them in:</p>
          <div className="flex items-center gap-1.5">
            <input readOnly value={invite}
              className="min-w-0 flex-1 truncate rounded-lg border border-line bg-space/60 px-2 py-1.5 text-[11px] text-dim" />
            <button type="button" onClick={copy}
              className="flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold text-space"
              style={{ background: TRUST_ACCENT }}>
              <Copy size={12} /> {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-2 flex gap-1">
            <TabBtn id="search" icon={<Search size={12} />} label="Recommend" />
            <TabBtn id="name" icon={<Type size={12} />} label="Name" />
            <TabBtn id="invite" icon={<UserPlus size={12} />} label="Invite" />
          </div>

          {mode === "search" && (
            <div className="mt-2 space-y-1.5">
              <div className="flex items-center gap-1.5 rounded-lg border border-line bg-space/60 px-2">
                <Search size={12} className="text-faint" />
                <input autoFocus value={q} onChange={(e) => setQ(e.target.value)}
                  placeholder="Search people & entities you trust…"
                  className="w-full bg-transparent py-1.5 text-[12.5px] text-ink outline-none placeholder:text-faint" />
              </div>
              {searching ? (
                <div className="flex justify-center py-1.5 text-dim"><Loader2 size={13} className="animate-spin" /></div>
              ) : results.length > 0 ? (
                <div className="space-y-1">
                  {results.map((n) => (
                    <button key={n.id} type="button" disabled={busy}
                      onClick={() => answer({ nodeId: n.id }, `Recommended ${n.label} — you trust them on this`)}
                      className="flex w-full items-center gap-2 rounded-lg border border-line/60 bg-space/50 px-2 py-1.5 text-left hover:border-gold/50">
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold"
                        style={{ background: withAlpha(TRUST_ACCENT, 0.18), color: TRUST_ACCENT }}>
                        {n.label.charAt(0).toUpperCase()}
                      </span>
                      <span className="truncate text-[12.5px] text-ink">{n.label}</span>
                      <span className="ml-auto shrink-0 text-[10px] capitalize text-faint">
                        {String(n.entityType ?? n.type ?? "").replace(/_/g, " ")}
                      </span>
                    </button>
                  ))}
                </div>
              ) : q.trim().length >= 2 ? (
                <p className="py-1 text-center text-[11px] text-faint">
                  No match — <button type="button" className="underline" style={{ color: TRUST_ACCENT }} onClick={() => setMode("invite")}>invite them</button> or <button type="button" className="underline" style={{ color: TRUST_ACCENT }} onClick={() => setMode("name")}>name them</button>.
                </p>
              ) : null}
            </div>
          )}

          {mode === "name" && (
            <div className="mt-2 flex items-center gap-2">
              <input value={name} onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && name.trim() && answer({ label: name.trim() }, "Answered — you now trust them on this")}
                placeholder={`Name a ${topicLabel} you trust`}
                className="min-w-0 flex-1 rounded-lg border border-line bg-space/60 px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-gold/60" />
              <button type="button" disabled={!name.trim() || busy}
                onClick={() => answer({ label: name.trim() }, "Answered — you now trust them on this")}
                className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold text-space disabled:opacity-50"
                style={{ background: TRUST_ACCENT }}>
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
              </button>
            </div>
          )}

          {mode === "invite" && (
            <div className="mt-2">
              <button type="button" onClick={doInvite} disabled={busy}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-line py-2 text-[12.5px] font-semibold text-ink hover:border-gold/60">
                {busy ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13} />} Create an invite link
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MyAskCard({ ask }: { ask: MyAsk }) {
  return (
    <div className="rounded-xl border border-line bg-space/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] text-ink">
          You asked for a <b>{ask.topic.replace(/_/g, " ")}</b>
          {ask.geo ? ` in ${ask.geo}` : ""}
        </p>
        <span className="shrink-0 text-[10px] uppercase tracking-wider text-faint">{ask.status}</span>
      </div>
      {ask.answers.length === 0 ? (
        <p className="mt-1.5 text-[12px] text-faint">Waiting for friends to answer…</p>
      ) : (
        <div className="mt-2 space-y-1">
          {ask.answers.map((ans) => (
            <div key={ans.id} className="flex items-center gap-1.5 text-[12.5px]">
              <span className="text-dim">{ans.responderName}</span>
              <span className="text-faint">→</span>
              <span className="font-medium text-ink">{ans.providerLabel}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
