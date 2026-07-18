"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, Check, Ear, Loader2, Radio, Sparkles, UserMinus, X, Zap, Megaphone,
} from "lucide-react";
import { GOLD } from "@/lib/palette";

/**
 * Listen — the recommendation-permission surface (#7). Listening means "this
 * person's future recommendations become part of my recommendation network."
 * It is directional, acceptance-based, capacity-bounded, and NEVER trust:
 * nothing on this page creates or displays trust.
 */

interface ListenState {
  listening: { id: string; name?: string }[];
  listeners: { id: string; name?: string }[];
  slots: {
    used: number;
    capacity: number;
    remaining: number;
    breakdown?: { base: number; fromContribution: number; fromTenure: number; fromBoosts: number };
  };
  contribution: number;
  policy: "manual" | "auto_accept";
  config: { contributionPerSlot: number; weeksPerSlot?: number };
}
interface Requests {
  incoming: { id: number; requesterId: string; requesterName?: string; expiresAt: string }[];
  outgoing: { id: number; targetId: string; targetName?: string; expiresAt: string }[];
}
interface Suggestion { id: string; name?: string; score: number; reasons: string[] }
interface CreditsInfo { balance: number; config: { boost: { cost: number; days: number; slots: number } } }
interface FeedRec {
  id: string;
  author: { id?: unknown; name?: string };
  target: { id?: unknown; name?: string };
  topic?: string;
  why?: string[];
}

function Card({ title, icon: Icon, children, count }: {
  title: string; icon: React.ElementType; children: React.ReactNode; count?: number;
}) {
  return (
    <section className="rounded-2xl border border-line bg-[rgba(14,16,30,0.72)] p-5 backdrop-blur-xl">
      <h2 className="mb-3 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.14em] text-faint">
        <Icon size={14} /> {title}
        {count !== undefined && count > 0 && (
          <span className="rounded-full bg-[rgba(255,140,90,0.15)] px-1.5 text-[10px] font-bold text-[#ff8c5a]">{count}</span>
        )}
      </h2>
      {children}
    </section>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => (
  <p className="text-[12.5px] text-faint">{children}</p>
);

export default function ListenPage() {
  const [listen, setListen] = useState<ListenState | null>(null);
  const [requests, setRequests] = useState<Requests | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [credits, setCredits] = useState<CreditsInfo | null>(null);
  const [feed, setFeed] = useState<FeedRec[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [asked, setAsked] = useState<Record<string, string>>({}); // personId → status msg

  const load = useCallback(async () => {
    try {
      const [l, r, s, c, f] = await Promise.all([
        fetch("/api/listen", { cache: "no-store" }).then((x) => x.json()),
        fetch("/api/listen/requests", { cache: "no-store" }).then((x) => x.json()),
        fetch("/api/listen/suggestions", { cache: "no-store" }).then((x) => x.json()),
        fetch("/api/credits", { cache: "no-store" }).then((x) => x.json()),
        fetch("/api/listen/feed", { cache: "no-store" }).then((x) => x.json()),
      ]);
      setListen(l);
      setRequests(r);
      setSuggestions(s.suggestions ?? []);
      setCredits(c);
      setFeed((f.recommendations ?? []).slice(0, 6));
    } catch {
      setError("Couldn't load your listening state.");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = async (key: string, fn: () => Promise<Response>) => {
    setBusy(key);
    try {
      await fn();
      await load();
    } finally {
      setBusy(null);
    }
  };

  const ask = async (personId: string) => {
    setBusy(personId);
    try {
      const r = await fetch("/api/listen/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetId: personId }),
      });
      const body = await r.json();
      setAsked((a) => ({
        ...a,
        [personId]: r.ok
          ? body.status === "accepted" ? "Listening ✓" : "Request sent"
          : (body.error ?? "Failed"),
      }));
      if (r.ok && body.status === "accepted") await load();
    } finally {
      setBusy(null);
    }
  };

  const boost = () => act("boost", () => fetch("/api/credits/boost", { method: "POST" }));
  const canBoost = credits && listen && credits.balance >= credits.config.boost.cost;
  const b = listen?.slots.breakdown;

  return (
    <main className="relative min-h-screen w-full overflow-y-auto bg-[#05060d] px-5 py-8 text-ink">
      <div className="mx-auto w-full max-w-3xl space-y-5">
        <header className="flex items-end justify-between">
          <div>
            <Link href="/" className="mb-2 inline-flex items-center gap-1.5 text-[12px] text-faint hover:text-ink">
              <ArrowLeft size={13} /> Back to Trusty
            </Link>
            <h1 className="text-2xl font-extrabold tracking-tight" style={{ fontFamily: "var(--font-display)" }}>
              Listening
            </h1>
            <p className="mt-1 max-w-lg text-[13px] text-dim">
              Listening means someone&apos;s future recommendations reach you. It&apos;s a permission —
              never friendship, never trust — and slots are earned, never bought.
            </p>
          </div>
        </header>

        {error && <div className="rounded-2xl border border-line bg-[rgba(14,16,30,0.72)] p-5 text-[13px] text-rose-300">{error}</div>}
        {!listen && !error && <div className="flex items-center gap-2 text-dim"><Loader2 className="animate-spin" size={16} /> Loading…</div>}

        {listen && (
          <>
            {/* slots */}
            <Card title="Your slots" icon={Radio}>
              <div className="flex flex-wrap items-center gap-4">
                <div className="text-[26px] font-bold" style={{ color: GOLD, fontFamily: "var(--font-mono)" }}>
                  {listen.slots.used}<span className="text-[16px] text-faint">/{listen.slots.capacity}</span>
                </div>
                {b && (
                  <div className="flex flex-wrap gap-1.5 text-[10.5px]">
                    <span className="rounded-full bg-[rgba(146,166,255,0.1)] px-2 py-0.5 text-dim">{b.base} base</span>
                    {b.fromContribution > 0 && <span className="rounded-full bg-[rgba(84,210,110,0.12)] px-2 py-0.5 text-[#54d26e]">+{b.fromContribution} contribution</span>}
                    {b.fromTenure > 0 && <span className="rounded-full bg-[rgba(63,198,244,0.12)] px-2 py-0.5 text-[#3fc6f4]">+{b.fromTenure} membership</span>}
                    {b.fromBoosts > 0 && <span className="rounded-full bg-[rgba(255,140,90,0.12)] px-2 py-0.5" style={{ color: GOLD }}>+{b.fromBoosts} boost</span>}
                  </div>
                )}
                {credits && (
                  <button
                    onClick={() => void boost()}
                    disabled={!canBoost || busy === "boost"}
                    title={canBoost ? undefined : `Needs ${credits.config.boost.cost} credits (you have ${credits.balance})`}
                    className="ml-auto flex items-center gap-1.5 rounded-xl border border-[rgba(255,140,90,0.3)] bg-[rgba(255,140,90,0.07)] px-3 py-1.5 text-[12px] font-semibold disabled:opacity-40"
                    style={{ color: GOLD }}
                  >
                    {busy === "boost" ? <Loader2 className="animate-spin" size={13} /> : <Zap size={13} />}
                    Boost +{credits.config.boost.slots} for {credits.config.boost.days}d · {credits.config.boost.cost} credits
                  </button>
                )}
              </div>
              <p className="mt-2 text-[11px] text-faint">
                Earn a slot for every {listen.config.contributionPerSlot} contribution points
                {listen.config.weeksPerSlot ? ` — plus one per ${listen.config.weeksPerSlot} weeks of membership` : ""}.
                Removing a connection frees its slot instantly.
              </p>
            </Card>

            {/* incoming requests */}
            {requests && requests.incoming.length > 0 && (
              <Card title="Wants to listen to you" icon={Megaphone} count={requests.incoming.length}>
                <ul className="space-y-2">
                  {requests.incoming.map((r) => (
                    <li key={r.id} className="flex items-center gap-3">
                      <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{r.requesterName ?? r.requesterId}</span>
                      <span className="text-[10.5px] text-faint">expires {new Date(r.expiresAt).toLocaleDateString()}</span>
                      <button disabled={busy === `acc_${r.id}`}
                        onClick={() => void act(`acc_${r.id}`, () => fetch(`/api/listen/requests/${r.id}/accept`, { method: "POST" }))}
                        className="flex items-center gap-1 rounded-lg bg-gold px-3 py-1 text-[12px] font-semibold text-space disabled:opacity-50">
                        <Check size={13} /> Accept
                      </button>
                      <button disabled={busy === `dec_${r.id}`}
                        onClick={() => void act(`dec_${r.id}`, () => fetch(`/api/listen/requests/${r.id}/decline`, { method: "POST" }))}
                        className="flex items-center gap-1 rounded-lg border border-line px-3 py-1 text-[12px] text-dim hover:text-ink disabled:opacity-50">
                        <X size={13} /> Decline
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[11px] text-faint">Accepting lets them receive your future recommendations. It never creates trust and is not reciprocal.</p>
              </Card>
            )}

            {/* suggestions */}
            <Card title="Who to listen to" icon={Sparkles}>
              {suggestions === null ? (
                <Empty>Loading…</Empty>
              ) : suggestions.length === 0 ? (
                <Empty>No suggestions yet — they appear as your interests and network grow.</Empty>
              ) : (
                <ul className="space-y-3">
                  {suggestions.map((s) => (
                    <li key={s.id} className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13.5px] font-medium">{s.name ?? s.id}</div>
                        <ul className="mt-0.5 space-y-0.5">
                          {s.reasons.map((why) => (
                            <li key={why} className="text-[11.5px] leading-snug text-dim">· {why}</li>
                          ))}
                        </ul>
                      </div>
                      {asked[s.id] ? (
                        <span className="shrink-0 pt-1 text-[11.5px] text-dim">{asked[s.id]}</span>
                      ) : (
                        <button disabled={busy === s.id || listen.slots.remaining === 0}
                          title={listen.slots.remaining === 0 ? "No free slots — remove a connection or earn more" : undefined}
                          onClick={() => void ask(s.id)}
                          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-[rgba(146,166,255,0.35)] bg-[rgba(146,166,255,0.08)] px-3 py-1.5 text-[12px] font-semibold text-ink hover:border-[rgba(146,166,255,0.55)] disabled:opacity-40">
                          {busy === s.id ? <Loader2 className="animate-spin" size={13} /> : <Ear size={13} />} Listen
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {/* listening + audience */}
            <div className="grid gap-5 sm:grid-cols-2">
              <Card title="You listen to" icon={Ear} count={listen.listening.length}>
                {listen.listening.length === 0 ? (
                  <Empty>No one yet — pick someone above whose knowledge you value.</Empty>
                ) : (
                  <ul className="space-y-2">
                    {listen.listening.map((p) => (
                      <li key={p.id} className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-[13px]">{p.name ?? p.id}</span>
                        <button disabled={busy === `rm_${p.id}`}
                          title="Stop listening — frees the slot"
                          onClick={() => void act(`rm_${p.id}`, () => fetch(`/api/listen/${encodeURIComponent(p.id)}`, { method: "DELETE" }))}
                          className="rounded-lg p-1 text-faint hover:text-rose-300 disabled:opacity-50">
                          <UserMinus size={14} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {requests && requests.outgoing.length > 0 && (
                  <div className="mt-3 border-t border-line pt-2">
                    <div className="mb-1 text-[10px] uppercase tracking-wider text-faint">Pending</div>
                    <ul className="space-y-1">
                      {requests.outgoing.map((r) => (
                        <li key={r.id} className="text-[12px] text-dim">{r.targetName ?? r.targetId} <span className="text-[10px] text-faint">awaiting acceptance</span></li>
                      ))}
                    </ul>
                  </div>
                )}
              </Card>

              <Card title="Listening to you" icon={Megaphone} count={listen.listeners.length}>
                {listen.listeners.length === 0 ? (
                  <Empty>No audience yet — it grows when your recommendations help people.</Empty>
                ) : (
                  <ul className="space-y-2">
                    {listen.listeners.map((p) => (
                      <li key={p.id} className="truncate text-[13px]">{p.name ?? p.id}</li>
                    ))}
                  </ul>
                )}
                <div className="mt-3 border-t border-line pt-2.5">
                  <div className="mb-1 text-[10px] uppercase tracking-wider text-faint">Requests to listen to me are</div>
                  <div className="flex gap-2">
                    {(["manual", "auto_accept"] as const).map((p) => (
                      <button key={p} disabled={busy === "policy"}
                        onClick={() => void act("policy", () => fetch("/api/listen/policy", {
                          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ policy: p }),
                        }))}
                        className={`rounded-lg border px-3 py-1 text-[11.5px] ${listen.policy === p ? "border-gold/60 bg-[rgba(255,140,90,0.1)] font-semibold" : "border-line text-dim hover:text-ink"}`}
                        style={listen.policy === p ? { color: GOLD } : undefined}>
                        {p === "manual" ? "Approved by me" : "Auto-accepted"}
                      </button>
                    ))}
                  </div>
                </div>
              </Card>
            </div>

            {/* feed */}
            <Card title="From people you listen to" icon={Radio}>
              {feed === null ? (
                <Empty>Loading…</Empty>
              ) : feed.length === 0 ? (
                <Empty>Nothing yet — when the people you listen to share recommendations, they show up here.</Empty>
              ) : (
                <ul className="space-y-3">
                  {feed.map((r) => (
                    <li key={r.id} className="rounded-xl border border-line/60 bg-[rgba(146,166,255,0.04)] p-3">
                      <div className="text-[13px]">
                        <b>{r.author.name ?? "Someone"}</b> recommends <b>{r.target.name ?? "…"}</b>
                        {r.topic && <span className="ml-1.5 rounded-full bg-[rgba(146,166,255,0.1)] px-2 py-0.5 text-[10px] text-dim">{r.topic}</span>}
                      </div>
                      {r.why && r.why.length > 0 && (
                        <div className="mt-1 text-[11.5px] text-faint">{r.why[0]}</div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </>
        )}
      </div>
    </main>
  );
}
