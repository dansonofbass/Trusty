"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, MapPin, Plus, Sparkles, UserPlus, X, Loader2, ArrowRight } from "lucide-react";
import { DOMAIN_LABEL, entityTypesByDomain, type EntityTypeDef } from "@constellation/graph-core";
import { GOLD, TRUST_ACCENT, withAlpha } from "@/lib/palette";
import { useUI } from "@/lib/store";
import { createEntity } from "@/lib/ontologyClient";
import { addTrust, trustSearch, type TrustRec } from "@/lib/trustClient";

/**
 * Trust onboarding — re-aimed from teaching the canvas to reaching the OUTCOME.
 *
 * The whole product is "find who your network trusts," so a new user's first ten
 * minutes should end in their first trust-search result — not a lesson in
 * panning a starfield. Three steps:
 *   1. pick the kinds of providers you can vouch for (topics),
 *   2. name 2–3 you'd actually vouch for  → creates the provider + a trust edge,
 *   3. see trust-search already work, then invite the friends you trust.
 *
 * Steps 1–2 build exactly enough graph that step 3 returns a real result.
 */

type Category = Pick<EntityTypeDef, "id" | "label" | "topic" | "baseType">;

interface Vouch {
  nodeId: string;
  name: string;
  topic: string;
  geo?: string;
  categoryLabel: string;
}

export default function TrustOnboarding({
  name,
  onDismiss,
}: {
  name: string;
  onDismiss: () => void;
}) {
  const bumpGraph = useUI((s) => s.bumpGraph);
  const setInviteOpen = useUI((s) => s.setInviteOpen);

  const domains = useMemo(() => entityTypesByDomain(), []);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [picked, setPicked] = useState<Category[]>([]);
  const [vouches, setVouches] = useState<Vouch[]>([]);
  const [error, setError] = useState<string | null>(null);

  const togglePick = (c: Category) =>
    setPicked((prev) =>
      prev.some((p) => p.id === c.id) ? prev.filter((p) => p.id !== c.id) : [...prev, c],
    );

  // Refresh the sky ONCE, on exit. Refreshing per-vouch would flip `meTrusts`
  // true and unmount the wizard mid-flow — so we let vouches accumulate against
  // the server (they're persisted immediately) and only reload the canvas when
  // the user leaves, by which point the modal is closing anyway.
  const close = () => {
    bumpGraph();
    onDismiss();
  };

  const finishInvite = () => {
    setInviteOpen(true);
    close();
  };

  return (
    <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center px-4">
      <div className="panel rise pointer-events-auto flex max-h-[86vh] w-full max-w-lg flex-col p-5">
        {/* header + progress */}
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span
              className="grid h-9 w-9 place-items-center rounded-xl text-[16px]"
              style={{ background: withAlpha(GOLD, 0.16), color: GOLD }}
            >
              ✦
            </span>
            <div>
              <div className="text-[14px] font-semibold text-ink">Welcome, {name}</div>
              <p className="text-[11.5px] text-[var(--color-dim)]">
                Let&apos;s get you a trusted recommendation in the next few minutes.
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Skip onboarding"
            className="rounded-lg p-1.5 text-[var(--color-faint)] hover:bg-[rgba(146,166,255,0.1)]"
            onClick={close}
          >
            <X size={15} />
          </button>
        </div>

        <Steps step={step} />

        {error && <p className="mt-2 text-[12px] text-rose-300">{error}</p>}

        {/* ------------------------------ step 1 ------------------------------ */}
        {step === 1 && (
          <>
            <div className="eyebrow mb-2 mt-3">What do you know well?</div>
            <p className="mb-3 text-[12.5px] text-[var(--color-dim)]">
              Pick the kinds of provider you could vouch for — a dentist, an
              immigration lawyer, a mechanic. Your picks become your trust topics.
            </p>
            <div className="-mr-1 flex-1 space-y-3 overflow-y-auto pr-1 scroll-quiet">
              {domains.map((d) => (
                <div key={d.domain}>
                  <div className="mb-1.5 text-[10.5px] uppercase tracking-[0.14em] text-[var(--color-faint)]">
                    {DOMAIN_LABEL[d.domain] ?? d.label}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {d.types.map((t) => {
                      const on = picked.some((p) => p.id === t.id);
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => togglePick(t)}
                          className="rounded-full border px-3 py-1.5 text-[12px] font-medium transition"
                          style={{
                            borderColor: on ? withAlpha(GOLD, 0.6) : "var(--color-line)",
                            background: on ? withAlpha(GOLD, 0.1) : "rgba(146,166,255,0.04)",
                            color: on ? "var(--color-ink)" : "var(--color-dim)",
                          }}
                        >
                          {on && <Check size={11} className="mr-1 inline" />}
                          {t.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <Footer>
              <button
                type="button"
                className="text-[11px] text-[var(--color-faint)] underline hover:text-ink"
                onClick={close}
              >
                I&apos;ll explore on my own
              </button>
              <button
                type="button"
                className="btn btn-gold"
                disabled={picked.length === 0}
                onClick={() => setStep(2)}
              >
                {picked.length > 0 ? `Continue with ${picked.length}` : "Pick at least one"}
                <ArrowRight size={13} />
              </button>
            </Footer>
          </>
        )}

        {/* ------------------------------ step 2 ------------------------------ */}
        {step === 2 && (
          <VouchStep
            categories={picked}
            vouches={vouches}
            onError={setError}
            onVouched={(v) => setVouches((prev) => [...prev, v])}
            onBack={() => setStep(1)}
            onContinue={() => setStep(3)}
          />
        )}

        {/* ------------------------------ step 3 ------------------------------ */}
        {step === 3 && (
          <ResultStep
            vouches={vouches}
            name={name}
            onInvite={finishInvite}
            onDone={close}
            onError={setError}
          />
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Steps({ step }: { step: 1 | 2 | 3 }) {
  const labels = ["Topics", "Vouch", "Search"];
  return (
    <div className="flex items-center gap-2">
      {labels.map((l, i) => {
        const n = (i + 1) as 1 | 2 | 3;
        const active = n === step;
        const done = n < step;
        return (
          <div key={l} className="flex items-center gap-2">
            <span
              className="grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold"
              style={{
                background: active || done ? GOLD : "var(--color-line)",
                color: active || done ? "#0b0e1c" : "var(--color-faint)",
              }}
            >
              {done ? <Check size={11} /> : n}
            </span>
            <span
              className="text-[11px] font-medium"
              style={{ color: active ? "var(--color-ink)" : "var(--color-faint)" }}
            >
              {l}
            </span>
            {i < 2 && <span className="text-[var(--color-line)]">·</span>}
          </div>
        );
      })}
    </div>
  );
}

function Footer({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 flex items-center justify-between gap-3 border-t border-[var(--color-line)] pt-3">
      {children}
    </div>
  );
}

/* ------------------------------- step 2 UI -------------------------------- */

function VouchStep({
  categories,
  vouches,
  onVouched,
  onBack,
  onContinue,
  onError,
}: {
  categories: Category[];
  vouches: Vouch[];
  onVouched: (v: Vouch) => void;
  onBack: () => void;
  onContinue: () => void;
  onError: (e: string | null) => void;
}) {
  const [catId, setCatId] = useState(categories[0]?.id ?? "");
  const [name, setName] = useState("");
  const [geo, setGeo] = useState("");
  const [saving, setSaving] = useState(false);

  const cat = categories.find((c) => c.id === catId) ?? categories[0];

  const submit = async () => {
    const label = name.trim();
    if (!label || !cat || saving) return;
    setSaving(true);
    onError(null);
    try {
      const { nodeId } = await createEntity({ entityType: cat.id, label, properties: {} });
      if (!nodeId) throw new Error("could not create that provider");
      await addTrust({
        to: nodeId,
        scope: { topic: cat.topic, geo: geo.trim() || undefined },
        confidence: 0.85,
      });
      onVouched({ nodeId, name: label, topic: cat.topic, geo: geo.trim() || undefined, categoryLabel: cat.label });
      setName("");
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="eyebrow mb-2 mt-3">Who do you vouch for?</div>
      <p className="mb-3 text-[12.5px] text-[var(--color-dim)]">
        Name a couple of people or places you&apos;d genuinely recommend. Each one
        becomes a trust edge — the raw material of your network&apos;s
        recommendations.
      </p>

      <div className="rounded-xl border border-[var(--color-line)] bg-[rgba(146,166,255,0.04)] p-3">
        <div className="flex flex-wrap gap-2">
          <select
            value={catId}
            onChange={(e) => setCatId(e.target.value)}
            className="rounded-lg border border-[var(--color-line)] bg-[rgba(11,14,28,0.6)] px-2.5 py-2 text-[12.5px] text-ink outline-none"
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <input
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder={`e.g. ${placeholderFor(cat?.topic)}`}
            className="min-w-0 flex-1 rounded-lg border border-[var(--color-line)] bg-[rgba(11,14,28,0.6)] px-3 py-2 text-[13px] text-ink outline-none placeholder:text-[var(--color-faint)] focus:border-[rgba(146,166,255,0.4)]"
          />
        </div>
        <div className="mt-2 flex items-center gap-2">
          <div className="relative flex-1">
            <MapPin
              size={13}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-faint)]"
            />
            <input
              value={geo}
              onChange={(e) => setGeo(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="City (optional) — e.g. Yerevan"
              className="w-full rounded-lg border border-[var(--color-line)] bg-[rgba(11,14,28,0.6)] py-2 pl-7 pr-3 text-[12.5px] text-ink outline-none placeholder:text-[var(--color-faint)] focus:border-[rgba(146,166,255,0.4)]"
            />
          </div>
          <button
            type="button"
            onClick={submit}
            disabled={!name.trim() || saving}
            className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12.5px] font-semibold text-[#0b0e1c] disabled:opacity-50"
            style={{ background: TRUST_ACCENT }}
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
            Vouch
          </button>
        </div>
      </div>

      {/* running list of trust edges created */}
      <div className="-mr-1 mt-3 flex-1 space-y-1.5 overflow-y-auto pr-1 scroll-quiet">
        {vouches.length === 0 && (
          <p className="py-4 text-center text-[12px] text-[var(--color-faint)]">
            No vouches yet — add one above. Two or three is a great start.
          </p>
        )}
        {vouches.map((v) => (
          <div
            key={v.nodeId}
            className="flex items-center gap-2.5 rounded-xl border p-2.5"
            style={{ borderColor: withAlpha(TRUST_ACCENT, 0.35), background: withAlpha(TRUST_ACCENT, 0.06) }}
          >
            <Check size={14} style={{ color: TRUST_ACCENT }} />
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">
              You trust <b>{v.name}</b>
            </span>
            <span className="text-[10.5px] text-[var(--color-faint)]">
              {v.categoryLabel}
              {v.geo ? ` · ${v.geo}` : ""}
            </span>
          </div>
        ))}
      </div>

      <Footer>
        <button
          type="button"
          className="text-[11px] text-[var(--color-faint)] underline hover:text-ink"
          onClick={onBack}
        >
          ← Topics
        </button>
        <button
          type="button"
          className="btn btn-gold"
          disabled={vouches.length === 0}
          onClick={onContinue}
        >
          {vouches.length === 0 ? "Add one to continue" : "See it work"}
          <ArrowRight size={13} />
        </button>
      </Footer>
    </>
  );
}

/* ------------------------------- step 3 UI -------------------------------- */

function ResultStep({
  vouches,
  name,
  onInvite,
  onDone,
  onError,
}: {
  vouches: Vouch[];
  name: string;
  onInvite: () => void;
  onDone: () => void;
  onError: (e: string | null) => void;
}) {
  const first = vouches[0];
  const [recs, setRecs] = useState<TrustRec[] | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "done">("idle");

  // Run the search once, on mount, for the first vouched topic.
  useEffect(() => {
    if (!first) return;
    let live = true;
    setStatus("loading");
    trustSearch({ topic: first.topic, geo: first.geo })
      .then((r) => live && setRecs(r.recommendations))
      .catch((e) => live && onError(e instanceof Error ? e.message : String(e)))
      .finally(() => live && setStatus("done"));
    return () => {
      live = false;
    };
    // Run exactly once for this step; `first` is stable by the time we're here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const top = (recs ?? []).slice(0, 3);

  return (
    <>
      <div className="eyebrow mb-2 mt-3">It already works</div>
      <p className="mb-3 text-[12.5px] text-[var(--color-dim)]">
        {first
          ? `Here's what a trust search for a ${first.topic.replace(/_/g, " ")}${
              first.geo ? ` in ${first.geo}` : ""
            } returns for you right now:`
          : "Add a vouch to see trust search in action."}
      </p>

      <div className="-mr-1 min-h-[96px] flex-1 space-y-2 overflow-y-auto pr-1 scroll-quiet">
        {status === "loading" && (
          <p className="flex items-center gap-2 text-[13px] text-[var(--color-dim)]">
            <Loader2 size={14} className="animate-spin" /> Tracing trust paths…
          </p>
        )}
        {status === "done" && top.length === 0 && (
          <div className="rounded-lg border border-[var(--color-line)] bg-[rgba(146,166,255,0.04)] p-3 text-[12.5px] text-[var(--color-dim)]">
            Your vouches are saved. As you and your friends trust more people, your
            searches will fill out — invite the friends whose taste you trust next.
          </div>
        )}
        {top.map((r) => (
          <div
            key={r.nodeId}
            className="rounded-xl border p-3"
            style={{ borderColor: withAlpha(TRUST_ACCENT, 0.4), background: withAlpha(TRUST_ACCENT, 0.06) }}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-semibold text-ink">{r.label}</span>
              <span className="text-[11px] uppercase tracking-wider text-[var(--color-faint)]">
                Trust {Math.round(Math.min(1, r.score) * 100)}% ·{" "}
                {r.hops === 1 ? "direct" : `${r.hops} hops`}
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px]">
              {r.pathLabels.map((p, i) => (
                <span key={i} className="flex items-center gap-1">
                  {i > 0 && <span className="text-[var(--color-faint)]">→</span>}
                  <span className={i === r.pathLabels.length - 1 ? "text-ink" : "text-[var(--color-dim)]"}>
                    {p}
                  </span>
                </span>
              ))}
            </div>
          </div>
        ))}
        {status === "done" && top.length > 0 && (
          <p className="pt-1 text-[12px] text-[var(--color-dim)]">
            That&apos;s the whole idea, {name} — recommendations you can trace back to
            people you trust. It gets far richer with friends in it.
          </p>
        )}
      </div>

      <Footer>
        <button
          type="button"
          className="text-[11px] text-[var(--color-faint)] underline hover:text-ink"
          onClick={onDone}
        >
          Explore my sky
        </button>
        <button type="button" className="btn btn-gold" onClick={onInvite}>
          <UserPlus size={13} />
          Invite friends you trust
        </button>
      </Footer>
    </>
  );
}

function placeholderFor(topic?: string): string {
  const map: Record<string, string> = {
    dentist: "Dr. Sarkisyan",
    doctor: "Dr. Ahmadi",
    lawyer: "Nara Petrosyan",
    immigration: "Migration Partners",
    mechanic: "Aram's Garage",
    plumber: "QuickFix Plumbing",
    electrician: "Volt Bros",
    accountant: "Ledger & Co",
    broker: "Hovik Realty",
    restaurant: "Lavash",
    cafe: "Coffeeshop Company",
    real_estate: "Sunny 2BR apartment",
    shopping: "Vernissage Market",
    travel: "Ararat Tours",
  };
  return (topic && map[topic]) ?? "their name";
}
