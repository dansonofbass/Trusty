"use client";

/**
 * Public specialist profile (#39) — /s/[nodeId], the stable canonical URL.
 *
 * Layered by information ORIGIN, never silently merged: provider-supplied
 * fields are labeled as such; the independent-evidence section is computed
 * server-side from recommendations/outcomes and cannot be edited here or
 * anywhere by the specialist. Trust shows as the frozen qualitative ladder,
 * never a raw percentage. Contact actions mark decision intent (feeding the
 * outcome loop + funnel) but explicitly do not imply an experience happened.
 */
import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  BadgeCheck, Globe, Landmark, Languages, Loader2, MapPin, MessageSquareQuote,
  Radio, Scale, ThumbsUp, ArrowLeft, ExternalLink, CalendarClock, BarChart3, Send,
} from "lucide-react";
import Brand from "@/components/Brand";
import RecommendButton from "@/components/RecommendButton";
import ClaimProfileButton from "@/components/ClaimProfileButton";
import SpecialistEditor from "@/components/SpecialistEditor";
import SpecialistAvatar from "@/components/specialist/SpecialistAvatar";
import { markIntent } from "@/lib/outcomeClient";
import { logClick, logImpressions } from "@/lib/interactionClient";

interface Field { value: unknown; source: string; updatedAt: string }
type Layer = Record<string, Field>;

interface ProfileView {
  nodeId: string;
  label: string;
  nodeType: string;
  state: string;
  layers: Partial<Record<"identity" | "taxonomy" | "operational" | "credential" | "communication" | "content", Layer>>;
  isManager: boolean;
  isAdmin?: boolean;
  pendingClaim: boolean;
  evidence: {
    recCount: number;
    outcomeCount: number;
    distinctContributors: number;
    topics: { topic: string; count: number }[];
    label: string;
    labelText: string;
  };
}

interface Verification {
  id: string;
  type: string;
  what: string;
  source: string;
  verifiedAt: string;
  expiresAt: string | null;
  status: "active" | "expired" | "revoked" | "uncertain";
}

const VERIFICATION_LABEL: Record<string, string> = {
  identity: "Identity verified",
  professional_email: "Professional email verified",
  organization_affiliation: "Organization verified",
  license: "License verified",
  office_location: "Office location verified",
  website_ownership: "Website verified",
  phone: "Phone verified",
  credential: "Credential verified",
};

interface Rec {
  id: string;
  author: { id: string; name?: string };
  topic?: string;
  context?: string;
  reasons?: string[];
  note?: string;
  createdAt?: number;
  consensus?: { supporters: number; score: number };
}

const TYPE_LABEL: Record<string, string> = {
  lawyer: "Lawyer", broker: "Real-estate broker", immigration_consultant: "Immigration consultant",
  accountant: "Accountant", doctor: "Doctor", dentist: "Dentist", mechanic: "Mechanic",
  plumber: "Plumber", electrician: "Electrician",
};

const asStr = (f?: Field): string | null => (typeof f?.value === "string" && f.value.trim() ? f.value : null);
const asList = (f?: Field): string[] =>
  Array.isArray(f?.value) ? (f.value as unknown[]).filter((x): x is string => typeof x === "string") : [];

export default function SpecialistProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [view, setView] = useState<ProfileView | null>(null);
  const [recs, setRecs] = useState<Rec[]>([]);
  const [verifications, setVerifications] = useState<Verification[]>([]);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [intentSent, setIntentSent] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/specialists/${encodeURIComponent(id)}`, { cache: "no-store" });
        if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `profile unavailable (${r.status})`);
        const v = (await r.json()) as ProfileView;
        if (!alive) return;
        setView(v);
        setStatus("ok");
        logImpressions([v.nodeId]); // funnel: profile viewed
        const [rr, vr] = await Promise.all([
          fetch(`/api/recs?target=${encodeURIComponent(id)}`, { cache: "no-store" }),
          fetch(`/api/specialists/${encodeURIComponent(id)}/verifications`, { cache: "no-store" }),
        ]);
        if (rr.ok && alive) setRecs(((await rr.json()) as { recommendations: Rec[] }).recommendations);
        if (vr.ok && alive) setVerifications(((await vr.json()) as { verifications: Verification[] }).verifications);
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : String(e));
        setStatus("error");
      }
    })();
    return () => { alive = false; };
  }, [id, nonce]);

  const contact = useCallback(
    async (kind: "phone" | "website" | "booking" | "telegram", href: string) => {
      if (!view) return;
      logClick(view.nodeId, view.evidence.topics[0]?.topic); // funnel: contact action
      if (!intentSent) {
        setIntentSent(true);
        // Decision intent, not an experience — the outcome loop follows up later.
        void markIntent({ nodeId: view.nodeId, topic: view.evidence.topics[0]?.topic }).catch(() => {});
      }
      window.open(href, "_blank", "noopener");
      void kind;
    },
    [view, intentSent],
  );

  if (status === "loading") {
    return (
      <div className="relative z-10 grid min-h-[100dvh] place-items-center text-dim">
        <Loader2 className="animate-spin" size={22} />
      </div>
    );
  }
  if (status === "error" || !view) {
    return (
      <div className="relative z-10 grid min-h-[100dvh] place-items-center p-6">
        <div className="panel max-w-md rounded-2xl p-8 text-center">
          <Scale className="mx-auto mb-3 text-faint" size={26} />
          <p className="text-[14px] text-ink">{error ?? "Profile unavailable"}</p>
          <Link href="/" className="mt-4 inline-block text-[13px] text-[var(--color-accent)]">← Back to Trusty</Link>
        </div>
      </div>
    );
  }

  const L = view.layers;
  const languages = asList(L.communication?.languages);
  const services = asList(L.taxonomy?.services);
  const contexts = asList(L.taxonomy?.clientContexts);
  const bio = asStr(L.content?.biography);
  const website = asStr(L.content?.website);
  const officeAddress = asStr(L.operational?.officeAddress);
  const bookingUrl = asStr(L.operational?.bookingUrl);
  const telegramHandle = asStr(L.operational?.telegramHandle);
  const photoUrl = asStr(L.identity?.photoUrl);
  const faq = asStr(L.content?.faq);
  const providerUpdated = Object.values(L.content ?? {})[0]?.updatedAt;

  const evidenceTopics = new Set(view.evidence.topics.map((t) => t.topic));

  return (
    <div className="relative z-10 mx-auto min-h-[100dvh] max-w-2xl px-4 pb-16 pt-4">
      <div className="mb-4 flex items-center gap-3">
        <Link href="/" aria-label="Back to Trusty" className="text-faint hover:text-ink"><ArrowLeft size={17} /></Link>
        <Brand size={20} />
      </div>

      {/* ---------------- header ---------------- */}
      <header className="panel rounded-2xl p-5">
        <div className="flex flex-wrap items-start gap-3">
          <SpecialistAvatar label={view.label} photoUrl={photoUrl ?? undefined} size={56} rounded="rounded-2xl" />
          <div className="min-w-0 flex-1">
            <h1 className="text-[19px] font-extrabold leading-tight text-ink" style={{ fontFamily: "var(--font-display)" }}>
              {view.label}
            </h1>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-dim">
              <span>{TYPE_LABEL[view.nodeType] ?? view.nodeType}</span>
              {officeAddress && <span className="flex items-center gap-1"><MapPin size={11} /> {officeAddress}</span>}
              {languages.length > 0 && <span className="flex items-center gap-1"><Languages size={11} /> {languages.join(", ")}</span>}
            </div>
            {/* Trust = frozen qualitative ladder, scoped explanation, no % */}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span
                className="rounded-full px-2.5 py-0.5 text-[11px] font-bold"
                style={{ background: "var(--color-accent-soft)", color: "var(--color-accent)" }}
                title="Derived only from independent recommendations and recorded outcomes on Trusty — never from payment, profile completeness, or verification."
              >
                {view.evidence.labelText}
              </span>
              <span className="text-[11px] text-faint">
                {view.evidence.recCount} recommendation{view.evidence.recCount === 1 ? "" : "s"} ·{" "}
                {view.evidence.outcomeCount} outcome{view.evidence.outcomeCount === 1 ? "" : "s"} ·{" "}
                {view.evidence.distinctContributors} contributor{view.evidence.distinctContributors === 1 ? "" : "s"}
              </span>
            </div>
          </div>
        </div>

        {/* primary actions */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <RecommendButton targetId={view.nodeId} targetLabel={view.label} nodeType="location" />
          {bookingUrl && (
            <button
              onClick={() => void contact("booking", bookingUrl)}
              className="flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-[13px] font-bold text-space"
              style={{ background: "var(--color-accent)", fontFamily: "var(--font-display)" }}
            >
              <CalendarClock size={14} /> Book a consultation
            </button>
          )}
          {website && (
            <button
              onClick={() => void contact("website", website)}
              className="flex items-center gap-1.5 rounded-xl border border-line px-3.5 py-2 text-[13px] font-semibold text-dim hover:text-ink"
            >
              <Globe size={14} /> Website <ExternalLink size={11} />
            </button>
          )}
          {telegramHandle && (
            <button
              onClick={() => void contact("telegram", `https://t.me/${telegramHandle}`)}
              className="flex items-center gap-1.5 rounded-xl border border-line px-3.5 py-2 text-[13px] font-semibold text-dim hover:text-ink"
            >
              <Send size={14} /> Telegram <ExternalLink size={11} />
            </button>
          )}
          {(view.isManager || view.isAdmin) && (
            <>
              <SpecialistEditor
                nodeId={view.nodeId}
                nodeType={view.nodeType}
                label={view.label}
                layers={view.layers}
                onSaved={() => setNonce((n) => n + 1)}
              />
              <Link
                href={`/s/${encodeURIComponent(view.nodeId)}/dashboard`}
                className="flex items-center gap-1.5 rounded-xl border border-line px-3.5 py-2 text-[13px] font-semibold text-dim hover:text-ink"
              >
                <BarChart3 size={14} /> Intelligence
              </Link>
            </>
          )}
        </div>
        <div className="mt-3">
          <ClaimProfileButton nodeId={view.nodeId} nodeType={view.nodeType} label={view.label} />
        </div>
      </header>

      {/* ---------------- provider-supplied ---------------- */}
      {(bio || services.length > 0 || contexts.length > 0 || faq) && (
        <section className="panel mt-4 rounded-2xl p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[13px] font-extrabold uppercase tracking-wide text-faint">About this specialist</h2>
            <span className="rounded-full bg-[var(--color-tint)] px-2 py-0.5 text-[10px] font-semibold text-faint"
              title={providerUpdated ? `Updated ${new Date(providerUpdated).toLocaleDateString()}` : undefined}>
              provider-supplied
            </span>
          </div>
          {bio && <p className="mt-3 text-[13.5px] leading-relaxed text-ink">{bio}</p>}
          {services.length > 0 && (
            <div className="mt-3">
              <div className="text-[11.5px] font-semibold text-dim">Services</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {services.map((s) => (
                  <span key={s} className="rounded-full border border-line px-2.5 py-1 text-[12px] text-dim">{s}</span>
                ))}
              </div>
            </div>
          )}
          {contexts.length > 0 && (
            <div className="mt-3">
              <div className="text-[11.5px] font-semibold text-dim">Relevant client contexts</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {contexts.map((c) => (
                  <span
                    key={c}
                    className="rounded-full border border-line px-2.5 py-1 text-[12px] text-dim"
                    style={evidenceTopics.has(c.toLowerCase()) ? { borderColor: "var(--color-accent-line)", color: "var(--color-accent)" } : undefined}
                    title={evidenceTopics.has(c.toLowerCase()) ? "Also supported by independent evidence" : "Provider-declared"}
                  >
                    {c}
                  </span>
                ))}
              </div>
            </div>
          )}
          {faq && (
            <div className="mt-3">
              <div className="text-[11.5px] font-semibold text-dim">FAQ</div>
              <p className="mt-1 whitespace-pre-line text-[13px] leading-relaxed text-dim">{faq}</p>
            </div>
          )}
        </section>
      )}

      {/* ---------------- independent evidence ---------------- */}
      <section className="panel mt-4 rounded-2xl p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[13px] font-extrabold uppercase tracking-wide text-faint">Independent evidence</h2>
          <span className="flex items-center gap-1 rounded-full bg-[var(--color-tint)] px-2 py-0.5 text-[10px] font-semibold text-faint"
            title="Written by Trusty members. The specialist cannot edit, buy, or remove this section.">
            <BadgeCheck size={10} /> not editable by the specialist
          </span>
        </div>

        {view.evidence.topics.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {view.evidence.topics.map((t) => (
              <span key={t.topic} className="rounded-full px-2.5 py-1 text-[12px] font-semibold"
                style={{ background: "var(--color-accent-soft)", color: "var(--color-accent)" }}>
                {t.topic.replace(/_/g, " ")} × {t.count}
              </span>
            ))}
          </div>
        )}

        {recs.length === 0 && (
          <p className="mt-3 text-[13px] text-dim">
            No independent recommendations yet. Trust on Trusty is earned through real
            recommendations and outcomes — it cannot be purchased.
          </p>
        )}

        {recs.slice(0, 6).map((r) => (
          <div key={r.id} className="mt-3 rounded-xl border border-line p-3">
            <div className="flex items-center gap-2 text-[12px] text-dim">
              <span className="font-semibold text-ink">{r.author.name ?? "A member"}</span>
              {r.topic && <span className="rounded-full bg-[var(--color-tint)] px-2 py-0.5 text-[10.5px]">{r.topic.replace(/_/g, " ")}</span>}
              {r.consensus && r.consensus.supporters > 0 && (
                <span className="ml-auto flex items-center gap-1 text-[11px] text-[var(--color-accent)]">
                  <ThumbsUp size={11} /> {r.consensus.supporters}
                </span>
              )}
            </div>
            {r.note && (
              <p className="mt-1.5 flex gap-1.5 text-[13px] italic leading-relaxed text-dim">
                <MessageSquareQuote size={13} className="mt-0.5 shrink-0 text-faint" /> {r.note}
              </p>
            )}
            {(r.reasons ?? []).length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {(r.reasons ?? []).map((x) => (
                  <span key={x} className="rounded-full border border-line px-2 py-0.5 text-[11px] text-faint">{x}</span>
                ))}
              </div>
            )}
          </div>
        ))}
      </section>

      {/* ---------------- credentials & verification -------- */}
      <section className="panel mt-4 rounded-2xl p-5">
        <h2 className="text-[13px] font-extrabold uppercase tracking-wide text-faint">Credentials &amp; verification</h2>
        {verifications.length === 0 ? (
          <p className="mt-2 flex items-start gap-2 text-[13px] text-dim">
            <Landmark size={14} className="mt-0.5 shrink-0 text-faint" />
            No credentials have been independently verified yet. Verification confirms specific
            claims (license, email, location) — it never implies service quality.
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            {verifications.map((v) => {
              const active = v.status === "active";
              return (
                <div key={v.id} className="flex items-start gap-2.5 rounded-xl border border-line p-3">
                  <BadgeCheck size={15} className="mt-0.5 shrink-0" style={{ color: active ? "var(--color-accent)" : "var(--color-faint)" }} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`text-[13px] font-semibold ${active ? "text-ink" : "text-faint line-through"}`}>
                        {VERIFICATION_LABEL[v.type] ?? v.type}
                      </span>
                      {!active && (
                        <span className="rounded-full bg-[var(--color-tint)] px-2 py-0.5 text-[10px] font-bold uppercase text-faint">
                          {v.status}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-[12px] text-dim">{v.what}</div>
                    <div className="mt-0.5 text-[11px] text-faint">
                      {v.source} · verified {new Date(v.verifiedAt).toLocaleDateString()}
                      {v.expiresAt && <> · {active ? "expires" : "expired"} {new Date(v.expiresAt).toLocaleDateString()}</>}
                    </div>
                  </div>
                </div>
              );
            })}
            <p className="text-[11px] text-faint">
              Each badge states exactly what was checked and when. Verification never implies
              service quality or trust.
            </p>
          </div>
        )}
      </section>

      <footer className="mt-6 flex items-center justify-center gap-2 text-[11px] text-faint">
        <Radio size={11} /> Trust on Trusty comes only from independent recommendations and real outcomes.
      </footer>
    </div>
  );
}
