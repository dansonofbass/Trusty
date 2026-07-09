"use client";

import { useCallback, useEffect, useState } from "react";
import { Megaphone, Send, Loader2, Check } from "lucide-react";
import { TRUST_ACCENT, withAlpha } from "@/lib/palette";
import { answerAsk, askInbox, myAsks, type InboxAsk, type MyAsk } from "@/lib/asksClient";

/**
 * Ask-my-network surface. Two halves of the loop:
 *  - "Asks for you": open asks from friends → naming a provider creates YOUR
 *    trust edge (and answers them), turning a friend's dead-end into a real edge.
 *  - "Your asks": what you broadcast + who answered (which now surfaces in your
 *    trust search through the friend bridge).
 * The FAB badge nudges friends to answer — that's where the edges come from.
 */
export default function AsksPanel() {
  const [open, setOpen] = useState(false);
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

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-[76px] right-6 z-40 flex items-center gap-2 rounded-full border border-line bg-surface px-4 py-2 text-sm font-semibold text-ink shadow-lg backdrop-blur-md hover:border-gold/60"
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

function InboxCard({ ask, onAnswered }: { ask: InboxAsk; onAnswered: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const r = await answerAsk(ask.id, { label: name.trim() });
      if (r.ok) {
        setDone(true);
        setTimeout(onAnswered, 900);
      }
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-line bg-space/40 p-3">
      <p className="text-[13px] text-ink">
        <b>{ask.askerName}</b> is looking for a{" "}
        <b style={{ color: TRUST_ACCENT }}>{ask.topic.replace(/_/g, " ")}</b>
        {ask.geo ? ` in ${ask.geo}` : ""}.
      </p>
      {ask.note && <p className="mt-1 text-[12px] italic text-dim">“{ask.note}”</p>}

      {done ? (
        <p className="mt-2 flex items-center gap-1.5 text-[12.5px]" style={{ color: TRUST_ACCENT }}>
          <Check size={14} /> Answered — you now trust them on this
        </p>
      ) : (
        <div className="mt-2 flex items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder={`Name a ${ask.topic.replace(/_/g, " ")} you trust`}
            className="min-w-0 flex-1 rounded-lg border border-line bg-space/60 px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-gold/60"
          />
          <button
            type="button"
            onClick={submit}
            disabled={!name.trim() || busy}
            className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold text-space disabled:opacity-50"
            style={{ background: TRUST_ACCENT }}
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
          </button>
        </div>
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
