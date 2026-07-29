"use client";

import FeedbackButton from "@/components/FeedbackButton";
import { QRShare, QRScan } from "@/components/summit/QRConnect";
import { QrCode as QrIcon, ScanLine } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Search, Share2, Monitor, LogOut, ChevronRight, ThumbsUp, ThumbsDown, Plus, Check, Loader2, Orbit, Megaphone, MapPin, Radio, PenLine, Compass } from "lucide-react";
import { TOPIC_TAXONOMY, type Dataset, type ThoughtExtraction } from "@constellation/graph-core";
import { GOLD, TRUST_ACCENT } from "@/lib/palette";
import { useUI } from "@/lib/store";
import Brand from "@/components/Brand";
import GeoSelect from "@/components/GeoSelect";
import { addTrust, recordOutcome, resolveScope, trustSearch, type ResolvedScope, type TrustRec } from "@/lib/trustClient";
import { createInvite } from "@/lib/inviteClient";
import { markIntent } from "@/lib/outcomeClient";
import { createAsk } from "@/lib/asksClient";
import { browsePlaces, type CatalogPlace } from "@/lib/placesClient";
import { createClient, type GraphClient } from "@/lib/dataSource";
import { ingestExtraction, streamExtract, type ExtractStreamEvent } from "@/lib/extractClient";
import type { TrustAssertion } from "@/lib/trustClient";
import OutcomePrompts from "@/components/OutcomePrompts";
import AsksPanel from "@/components/AsksPanel";
import ImportPlaces from "@/components/ImportPlaces";
import Composer from "@/components/Composer";
import JourneysPanel from "@/components/composer/JourneysPanel";
import { FeedContent } from "@/components/FeedPanel";

// The graph tab is heavy (force-graph) — load it only when the user opens it.
const MobileGraph = dynamic(() => import("@/components/MobileGraph"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-[13px] text-dim">Loading your galaxy…</div>
  ),
});

/**
 * Mobile trust search (Phase 4). The phone is where people actually look for a
 * plumber, so this is search-FIRST and canvas-free: a query resolves to a scope,
 * then ranked providers each show their because-path as a plain breadcrumb
 * (You → Sara → Dr. X), not a starfield. Reuses the same session-authed BFF
 * trust routes as the desktop overlay — no new backend.
 */

// Curated quick-start topics (the ones with real provider ontologies).
const QUICK_TOPICS = [
  "dentist", "doctor", "plumber", "electrician", "mechanic",
  "lawyer", "immigration", "accountant", "broker", "restaurant", "cafe",
].filter((t) => TOPIC_TAXONOMY.includes(t));

type MobileTab = "feed" | "search" | "compose" | "decisions" | "graph";

export default function MobileSearch() {
  const router = useRouter();
  const [tab, setTab] = useState<MobileTab>("feed");
  const [qrMode, setQrMode] = useState<null | "share" | "scan">(null);
  const [meSub, setMeSub] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/auth/me").then((r) => (r.ok ? r.json() : null)).then((u) => u?.sub && setMeSub(u.sub)).catch(() => {});
    // QR deep link (/m?connect=<id>): open that person in the graph sheet.
    const cid = new URLSearchParams(window.location.search).get("connect");
    if (cid) {
      select(cid);
      setTab("graph");
      window.history.replaceState(null, "", "/m");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const clearSelection = useUI((s) => s.select);
  const select = useUI((s) => s.select);
  const bumpGraph = useUI((s) => s.bumpGraph);
  const geoScope = useUI((s) => s.geoScope);
  const setGeoScope = useUI((s) => s.setGeoScope);

  // Composer needs the graph dataset (mentions, weave) — loaded once, lazily,
  // when the Compose tab first opens. The graph tab keeps its own loader.
  const [data, setData] = useState<Dataset | null>(null);
  const [pending, setPending] = useState(false);
  const [prefill, setPrefill] = useState<string | null>(null);
  const clientRef = useRef<GraphClient | null>(null);
  useEffect(() => {
    if (tab !== "compose" || data || clientRef.current) return;
    clientRef.current = createClient("api");
    clientRef.current.load().then(setData).catch(() => {});
  }, [tab, data]);

  const handleExtract = useCallback(
    async (text: string, onEvent: (ev: ExtractStreamEvent) => void) => {
      setPending(true);
      try {
        const streamed = await streamExtract(text, { onEvent });
        return streamed.extraction;
      } catch {
        return null;
      } finally {
        setPending(false);
      }
    },
    [],
  );

  const handleWeave = useCallback(
    async (
      text: string,
      extraction: ThoughtExtraction,
      originalExtraction?: ThoughtExtraction,
      writingId?: string,
      trustAssertions?: TrustAssertion[],
    ) => {
      const meId = data?.meId ?? "me";
      setPending(true);
      try {
        const r = await ingestExtraction(meId, text, extraction, originalExtraction, writingId, trustAssertions);
        setData(r.dataset);
        bumpGraph(); // the graph tab reloads with the new thought/concepts
        const entityCount = r.dataset.links.filter(
          (l) =>
            (typeof l.source === "string" ? l.source : l.source.id) === r.thoughtId &&
            l.type === "MENTIONS",
        ).length;
        return { entityCount, conceptIds: r.conceptIds, thoughtId: r.thoughtId };
      } catch {
        return null;
      } finally {
        setPending(false);
      }
    },
    [data, bumpGraph],
  );

  const handleExplore = useCallback(
    (thoughtId: string) => {
      select(thoughtId);
      setTab("graph");
    },
    [select],
  );
  const [q, setQ] = useState("");
  const [scope, setScope] = useState<ResolvedScope | null>(null);
  const [recs, setRecs] = useState<TrustRec[]>([]);
  const [status, setStatus] = useState<"idle" | "resolving" | "searching" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  // "Near me" — one tap to grant geolocation; coords ride along on searches so
  // results get a distance. Toggling off clears it.
  const toggleNearMe = () => {
    if (coords) return setCoords(null);
    navigator.geolocation?.getCurrentPosition(
      (pos) => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setError("Location permission denied"),
      { enableHighAccuracy: false, timeout: 8000 },
    );
  };

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((u) => u && setMe(u.name ?? "You"))
      .catch(() => undefined);
  }, []);

  const run = useCallback(
    async (override?: { topic: string; geo?: string; context?: string }) => {
      setError(null);
      setStatus("resolving");
      try {
        let s: ResolvedScope;
        if (override) {
          s = override;
        } else {
          const text = q.trim();
          if (text.length < 2) return setStatus("idle");
          s = await resolveScope(text);
        }
        setScope(s);
        if (!s.topic) {
          setRecs([]);
          return setStatus("done");
        }
        setStatus("searching");
        const { recommendations } = await trustSearch({
          topic: s.topic,
          geo: s.geo,
          context: s.context,
          ...(coords ? { lat: coords.lat, lng: coords.lng } : {}),
        });
        setRecs(recommendations);
        setStatus("done");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStatus("error");
      }
    },
    [q, coords],
  );

  const pickTopic = (topic: string) => {
    setQ(topic.replace(/_/g, " "));
    run({ topic });
  };

  const shareInvite = async () => {
    setMenu(false);
    try {
      const { url } = await createInvite();
      const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
      if (nav.share) await nav.share({ title: "Join me on Trusty", text: "Find people our network trusts.", url });
      else {
        await navigator.clipboard.writeText(url);
        setError(null);
      }
    } catch {
      /* user cancelled share or clipboard blocked */
    }
  };

  const direct = recs.filter((r) => r.hops <= 1);
  const network = recs.filter((r) => r.hops > 1);
  const busy = status === "resolving" || status === "searching";

  return (
    // `relative z-10` lifts the whole view above the layout's fixed `.nebula`
    // (position:fixed; z-index:0) — without it, the nebula paints over the
    // results and only the z-indexed header/search bars stay visible.
    // Fixed-height shell: every tab scrolls internally above the bottom bar.
    <div className="relative z-10 flex h-[100dvh] flex-col overflow-hidden text-ink">
      {/* ---- app bar ---- */}
      <header className="z-20 flex shrink-0 items-center gap-2 border-b border-line bg-space/90 px-4 py-3 backdrop-blur-md" style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}>
        <Brand size={22} wordmark={false} />
        {/* Armenia scope — same selector as desktop, portal-rendered menu. */}
        <GeoSelect
          value={geoScope}
          onChange={setGeoScope}
          icon={<MapPin size={12} className="shrink-0" style={{ color: "var(--color-accent)" }} />}
          className="flex min-w-0 items-center gap-1 rounded-full border border-line bg-nebula/50 px-2.5 py-1.5 text-[12px] font-medium text-ink"
        />
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <FeedbackButton compact />
          <button type="button" onClick={() => setQrMode("share")} aria-label="My QR" className="rounded-lg border border-line p-1.5 text-[var(--color-faint)] hover:text-ink"><QrIcon size={14} /></button>
          <button type="button" onClick={() => setQrMode("scan")} aria-label="Scan QR" className="rounded-lg border border-line p-1.5 text-[var(--color-faint)] hover:text-ink"><ScanLine size={14} /></button>
          <button
            type="button"
            onClick={shareInvite}
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-semibold text-space"
            style={{ background: GOLD, fontFamily: "var(--font-display)" }}
          >
            <Share2 size={13} /> Invite
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenu((v) => !v)}
              aria-label="Menu"
              className="grid h-9 w-9 place-items-center rounded-full border border-line text-dim"
            >
              {me ? me[0]?.toUpperCase() : "·"}
            </button>
            {menu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} aria-hidden />
                <div className="absolute right-0 z-20 mt-2 w-44 rounded-xl border border-line bg-nebula/95 p-1 shadow-2xl backdrop-blur-md">
                  <button
                    type="button"
                    onClick={() => {
                      setMenu(false);
                      setImportOpen(true);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-[13px] text-dim hover:bg-white/5"
                  >
                    <MapPin size={14} /> Import places
                  </button>
                  <button
                    type="button"
                    onClick={() => router.push("/?desktop=1")}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-[13px] text-dim hover:bg-white/5"
                  >
                    <Monitor size={14} /> Desktop view
                  </button>
                  <a
                    href="/api/auth/logout"
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-[13px] text-dim hover:bg-white/5"
                  >
                    <LogOut size={14} /> Sign out
                  </a>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ---- search bar (search tab only) ---- */}
      {tab === "search" && (
      <div className="z-10 shrink-0 border-b border-line bg-space/90 px-4 pb-2.5 pt-2.5 backdrop-blur-md">
          <div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run();
          }}
          className="flex items-center gap-2 rounded-2xl border border-line bg-nebula/60 px-3 py-2.5 focus-within:border-[rgba(255,140,90,0.6)]"
        >
          <Search size={18} className="shrink-0 text-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            enterKeyHint="search"
            placeholder="plumber in Gyumri"
            className="min-w-0 flex-1 bg-transparent text-[16px] text-ink outline-none placeholder:text-faint"
          />
          {busy ? (
            <Loader2 size={18} className="shrink-0 animate-spin text-faint" />
          ) : (
            <button type="submit" className="shrink-0 rounded-xl px-3 py-1.5 text-[13px] font-bold text-space" style={{ background: TRUST_ACCENT }}>
              Go
            </button>
          )}
        </form>

        {/* quick topics + near-me */}
        <div className="-mx-4 mt-2.5 flex gap-2 overflow-x-auto px-4 pb-0.5 scroll-quiet">
          <button
            type="button"
            onClick={toggleNearMe}
            className="flex shrink-0 items-center gap-1 rounded-full border px-3 py-1.5 text-[12.5px] active:scale-95"
            style={
              coords
                ? { borderColor: withA(TRUST_ACCENT, 0.6), color: "var(--color-ink)", background: withA(TRUST_ACCENT, 0.1) }
                : { borderColor: "var(--color-line)", color: "var(--color-dim)" }
            }
          >
            <MapPin size={12} /> {coords ? "Near me ✓" : "Near me"}
          </button>
          {QUICK_TOPICS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => pickTopic(t)}
              className="shrink-0 rounded-full border border-line bg-nebula/50 px-3 py-1.5 text-[12.5px] text-dim active:scale-95"
              style={scope?.topic === t ? { borderColor: withA(TRUST_ACCENT, 0.6), color: "var(--color-ink)" } : undefined}
            >
              {t.replace(/_/g, " ")}
            </button>
          ))}
        </div>
          </div>
      </div>
      )}

      {/* ---- tab content (scrolls internally above the bottom bar) ---- */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === "feed" && (
          <div className="flex h-full min-h-0 flex-col">
            <FeedContent
              selected={null}
              onJump={(id) => {
                select(id);
                setTab("graph");
              }}
            />
          </div>
        )}

        {tab === "search" && (
          <main className="scroll-quiet h-full overflow-y-auto px-4 py-4">
            {status === "idle" && <Intro onPick={pickTopic} />}
            {busy && <p className="mt-6 text-center text-[14px] text-dim">Tracing trust paths…</p>}
            {error && <p className="mt-6 text-center text-[14px] text-rose-300">{error}</p>}

            {status === "done" && recs.length === 0 && scope?.topic && (
              <ColdStart topic={scope.topic} geo={scope.geo} coords={coords} onInvite={shareInvite} />
            )}

            {direct.length > 0 && (
              <Section title="You trust directly">
                {direct.map((r) => (
                  <ResultCard key={r.nodeId} rec={r} topic={scope?.topic ?? ""} geo={scope?.geo} />
                ))}
              </Section>
            )}
            {network.length > 0 && (
              <Section title="Trusted through your network">
                {network.map((r) => (
                  <ResultCard key={r.nodeId} rec={r} topic={scope?.topic ?? ""} geo={scope?.geo} />
                ))}
              </Section>
            )}
            <div className="h-4" />
          </main>
        )}

        {tab === "compose" && (
          <Composer
            variant="page"
            nodes={data?.nodes ?? []}
            mode="api"
            pending={pending}
            onExtract={handleExtract}
            onWeave={handleWeave}
            onExplore={handleExplore}
            prefill={prefill ?? undefined}
            onPrefillConsumed={() => setPrefill(null)}
          />
        )}

        {tab === "decisions" && (
          <div className="scroll-quiet h-full overflow-y-auto px-4 pb-6">
            <JourneysPanel
              refreshKey={0}
              onDiscuss={(j) => {
                setPrefill(
                  `Continue my "${j.title}" decision journey (id ${j.id}) — summarize where I stand and suggest the next step.`,
                );
                setTab("compose");
              }}
            />
          </div>
        )}

        {tab === "graph" && (
          <div className="relative h-full min-h-0">
            <MobileGraph />
          </div>
        )}
      </div>

      {/* ---- bottom tab bar ---- */}
      <nav
        className="z-30 flex shrink-0 items-end justify-around border-t border-line bg-space/95 px-2 pt-1.5 backdrop-blur-md"
        style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
        aria-label="Sections"
      >
        <TabItem active={tab === "feed"} onClick={() => { clearSelection(null); setTab("feed"); }} icon={<Radio size={18} />} label="Feed" />
        <TabItem active={tab === "search"} onClick={() => { clearSelection(null); setTab("search"); }} icon={<Search size={18} />} label="Search" />
        {/* Compose — the ONE solid primary, dock-style */}
        <button
          type="button"
          onClick={() => setTab("compose")}
          aria-label="Compose"
          className="flex w-[62px] flex-col items-center gap-0.5"
        >
          <span
            className="grid h-11 w-11 place-items-center rounded-full transition active:scale-95"
            style={
              tab === "compose"
                ? { background: "var(--color-accent-soft)", border: "1px solid var(--color-accent-line)", color: "var(--color-accent)" }
                : { background: "var(--color-accent)", color: "var(--color-on-accent)", boxShadow: "0 6px 18px rgba(255,140,90,0.3)" }
            }
          >
            <PenLine size={18} strokeWidth={2.4} />
          </span>
          <span className="text-[9.5px] font-medium" style={{ color: tab === "compose" ? "var(--color-accent)" : "var(--color-faint)" }}>
            Compose
          </span>
        </button>
        <TabItem active={tab === "decisions"} onClick={() => setTab("decisions")} icon={<Compass size={18} />} label="Decisions" />
        <TabItem active={tab === "graph"} onClick={() => { clearSelection(null); setTab("graph"); }} icon={<Orbit size={18} />} label="Graph" />
      </nav>

      <OutcomePrompts />
      <AsksPanel />
      <ImportPlaces open={importOpen} onClose={() => setImportOpen(false)} />
      {qrMode === "share" && meSub && (
        <QRShare nodeId={meSub} label={me ?? "You"} brand="Trusty" path="/" onClose={() => setQrMode(null)} />
      )}
      {qrMode === "scan" && (
        <QRScan
          onFound={(nodeId) => {
            setQrMode(null);
            select(nodeId);
            setTab("graph");
          }}
          onClose={() => setQrMode(null)}
        />
      )}
    </div>
  );
}

function TabItem({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button type="button" onClick={onClick} className="flex w-[62px] flex-col items-center gap-0.5 py-1" aria-pressed={active}>
      <span style={{ color: active ? "var(--color-accent)" : "var(--color-faint)" }}>{icon}</span>
      <span className="text-[9.5px] font-medium" style={{ color: active ? "var(--color-accent)" : "var(--color-faint)" }}>
        {label}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ */

function withA(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, "$1$1") : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}


function Intro({ onPick }: { onPick: (t: string) => void }) {
  return (
    <div className="mx-auto mt-6 max-w-sm text-center">
      <h1 className="text-[22px] font-extrabold leading-tight text-ink" style={{ fontFamily: "var(--font-display)" }}>
        Who does your network trust?
      </h1>
      <p className="mt-2 text-[14px] leading-relaxed text-dim">
        Search a kind of provider — a dentist, a plumber, an immigration lawyer — and
        see who the people you trust vouch for, with the path shown.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {["dentist", "plumber", "lawyer"].map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onPick(t)}
            className="rounded-full border px-3.5 py-2 text-[13px] font-medium text-ink"
            style={{ borderColor: withA(TRUST_ACCENT, 0.4), background: withA(TRUST_ACCENT, 0.07) }}
          >
            Try “{t}”
          </button>
        ))}
      </div>
    </div>
  );
}

function ColdStart({
  topic,
  geo,
  coords,
  onInvite,
}: {
  topic: string;
  geo?: string;
  coords: { lat: number; lng: number } | null;
  onInvite: () => void;
}) {
  const [asked, setAsked] = useState(false);
  const [asking, setAsking] = useState(false);
  const [places, setPlaces] = useState<CatalogPlace[]>([]);
  const [loadingPlaces, setLoadingPlaces] = useState(true);

  // Fallback discovery: places that exist in the catalog (e.g. from OSM) but
  // that nobody in your network trusts yet — tap to trust and seed your search.
  useEffect(() => {
    let live = true;
    setLoadingPlaces(true);
    browsePlaces({ topic, geo, lat: coords?.lat, lng: coords?.lng, limit: 12 })
      .then((p) => live && setPlaces(p))
      .catch(() => undefined)
      .finally(() => live && setLoadingPlaces(false));
    return () => {
      live = false;
    };
  }, [topic, geo, coords]);

  const ask = async () => {
    setAsking(true);
    try {
      await createAsk({ topic, geo });
      setAsked(true);
    } catch {
      /* ignore */
    } finally {
      setAsking(false);
    }
  };

  return (
    <div className="mx-auto mt-6 max-w-sm space-y-4">
      <div className="rounded-2xl border border-line bg-nebula/40 p-5 text-center">
        <div className="text-[15px] font-semibold text-ink">
          No trusted path to a {topic.replace(/_/g, " ")}{geo ? ` in ${geo}` : ""} yet
        </div>
        <p className="mt-2 text-[13.5px] leading-relaxed text-dim">
          Ask your network — or trust a place below to seed your own recommendations.
        </p>
        {asked ? (
          <p className="mt-4 flex items-center justify-center gap-1.5 text-[13.5px] font-semibold" style={{ color: TRUST_ACCENT }}>
            <Check size={15} /> Asked your network — we&apos;ll surface answers here
          </p>
        ) : (
          <button
            type="button"
            onClick={ask}
            disabled={asking}
            className="mt-4 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[14px] font-bold text-space disabled:opacity-60"
            style={{ background: TRUST_ACCENT, fontFamily: "var(--font-display)" }}
          >
            {asking ? <Loader2 size={14} className="animate-spin" /> : <Megaphone size={14} />}
            Ask your network
          </button>
        )}
        <button
          type="button"
          onClick={onInvite}
          className="mt-2 block w-full text-[12.5px] text-dim underline-offset-2 hover:text-ink hover:underline"
        >
          or invite friends whose taste you trust
        </button>
      </div>

      {loadingPlaces && (
        <p className="text-center text-[12.5px] text-faint">Checking the catalog…</p>
      )}
      {places.length > 0 && (
        <section>
          <div className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-faint">
            In the catalog{coords ? " · nearest first" : ""}
          </div>
          <div className="space-y-2">
            {places.map((p) => (
              <CatalogCard key={p.nodeId} place={p} topic={topic} geo={geo} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function CatalogCard({ place, topic, geo }: { place: CatalogPlace; topic: string; geo?: string }) {
  const bumpGraph = useUI((s) => s.bumpGraph);
  const [trusted, setTrusted] = useState(place.trusted ?? false);
  const [busy, setBusy] = useState(false);

  const cuisine = Array.isArray(place.properties?.cuisine) ? (place.properties!.cuisine as string[]) : [];
  const price = typeof place.properties?.price_range === "string" ? (place.properties!.price_range as string) : undefined;
  const meta = [...cuisine.slice(0, 2).map((c) => c.replace(/_/g, " ")), price].filter(Boolean).join(" · ");

  const trust = async () => {
    setBusy(true);
    try {
      await addTrust({ to: place.nodeId, scope: { topic, geo }, confidence: 0.8 });
      setTrusted(true);
      bumpGraph();
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-nebula/40 p-3">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-semibold text-ink">{place.label}</div>
        <div className="truncate text-[11.5px] text-dim">
          {meta || place.entityType || "Place"}
          {place.distanceKm != null ? ` · ${place.distanceKm} km` : ""}
        </div>
      </div>
      {trusted ? (
        <span className="shrink-0 text-[12px] font-semibold" style={{ color: TRUST_ACCENT }}>
          Trusted ✓
        </span>
      ) : (
        <button
          type="button"
          onClick={trust}
          disabled={busy}
          className="shrink-0 rounded-full px-3 py-1.5 text-[12px] font-bold text-space disabled:opacity-60"
          style={{ background: TRUST_ACCENT }}
        >
          {busy ? "…" : "✦ Trust"}
        </button>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-faint">{title}</div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function ResultCard({ rec, topic, geo }: { rec: TrustRec; topic: string; geo?: string }) {
  const [outcome, setOutcome] = useState<"none" | "up" | "down">("none");
  const [trusted, setTrusted] = useState(false);
  const [intended, setIntended] = useState(false);
  const pct = Math.round(Math.min(1, rec.score) * 100);
  const lastHop = rec.trustPath?.[rec.trustPath.length - 1];

  const useThis = async () => {
    setIntended(true);
    try {
      await markIntent({ nodeId: rec.nodeId, edgeId: lastHop?.edgeId, topic, geo });
    } catch {
      setIntended(false);
    }
  };

  const judge = async (v: number) => {
    if (!lastHop) return;
    setOutcome(v >= 0 ? "up" : "down");
    try {
      await recordOutcome(lastHop.edgeId, v, rec.nodeId);
    } catch {
      /* best-effort */
    }
  };

  const trust = async () => {
    setTrusted(true);
    try {
      await addTrust({ to: rec.nodeId, scope: { topic, geo }, confidence: 0.8 });
    } catch {
      setTrusted(false);
    }
  };

  const cuisine = Array.isArray(rec.properties?.cuisine) ? (rec.properties!.cuisine as string[]) : [];
  const price = typeof rec.properties?.price_range === "string" ? (rec.properties!.price_range as string) : undefined;
  const placeMeta = [...cuisine.slice(0, 3).map((c) => c.replace(/_/g, " ")), price].filter(Boolean).join(" · ");

  return (
    <div className="rounded-2xl border border-line bg-nebula/50 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[16px] font-semibold text-ink">{rec.label}</div>
        {rec.distanceKm != null ? (
          <div className="flex shrink-0 items-center gap-0.5 text-[11px] font-medium" style={{ color: TRUST_ACCENT }}>
            <MapPin size={11} /> {rec.distanceKm} km
          </div>
        ) : (
          <div className="text-[11px] uppercase tracking-wider text-faint">{rec.nodeType}</div>
        )}
      </div>
      {placeMeta && <div className="mt-0.5 text-[12px] text-dim">{placeMeta}</div>}

      <div className="mt-2 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: TRUST_ACCENT }} />
        </div>
        <span className="shrink-0 text-[11px] uppercase tracking-wider text-faint">
          {pct}% · {rec.hops === 1 ? "direct" : `${rec.hops} hops`}
        </span>
      </div>

      {/* because-path breadcrumb */}
      <div className="mt-2.5 flex flex-wrap items-center gap-x-1 gap-y-1 text-[12.5px]">
        {rec.pathLabels.map((name, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <ChevronRight size={12} className="text-faint" />}
            <span className={i === rec.pathLabels.length - 1 ? "font-medium text-ink" : "text-dim"}>{name}</span>
          </span>
        ))}
      </div>

      {rec.reasons.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {rec.reasons.map((rc) => (
            <span key={rc} className="rounded-full border border-line px-2 py-0.5 text-[10.5px] text-dim">
              {rc.replace(/_/g, " ")}
            </span>
          ))}
        </div>
      )}

      <div className="mt-3 border-t border-line pt-3">
        {intended ? (
          <div className="text-[12.5px]" style={{ color: TRUST_ACCENT }}>
            ✓ We&apos;ll check back to ask how it went
          </div>
        ) : (
          <button
            type="button"
            onClick={useThis}
            className="w-full rounded-xl py-2.5 text-center text-[13.5px] font-bold text-space active:scale-[0.99]"
            style={{ background: TRUST_ACCENT }}
          >
            I&apos;ll contact them
          </button>
        )}
      </div>

      <div className="mt-2 flex items-center gap-2">
        {outcome === "none" ? (
          <>
            <span className="text-[12px] text-faint">Used them?</span>
            <button type="button" onClick={() => judge(1)} className="grid h-9 w-9 place-items-center rounded-full border border-line text-dim active:scale-90">
              <ThumbsUp size={15} />
            </button>
            <button type="button" onClick={() => judge(-1)} className="grid h-9 w-9 place-items-center rounded-full border border-line text-dim active:scale-90">
              <ThumbsDown size={15} />
            </button>
          </>
        ) : (
          <span className="text-[12px] text-faint">Thanks — noted {outcome === "up" ? "👍" : "👎"}</span>
        )}
        <div className="ml-auto">
          {trusted ? (
            <span className="inline-flex items-center gap-1 text-[12.5px]" style={{ color: TRUST_ACCENT }}>
              <Check size={14} /> You trust them
            </span>
          ) : (
            <button
              type="button"
              onClick={trust}
              className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] font-medium text-ink active:scale-95"
              style={{ borderColor: withA(TRUST_ACCENT, 0.5) }}
            >
              <Plus size={13} /> I trust them
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
