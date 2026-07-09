"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, ImageIcon, UtensilsCrossed, ChevronRight, ChevronLeft, Loader2 } from "lucide-react";
import { adminListPlaces, type AdminPlace } from "@/lib/placesClient";
import PlaceEditor from "@/components/admin/PlaceEditor";

type Filter = "all" | "restaurant" | "cafe" | "with_photos" | "no_details";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "restaurant", label: "Restaurants" },
  { key: "cafe", label: "Cafés" },
  { key: "with_photos", label: "With photos" },
  { key: "no_details", label: "Needs details" },
];

const propCount = (p: AdminPlace) => Object.keys(p.properties ?? {}).filter((k) => k !== "geo" && k !== "source").length;

export default function AdminPlacesPage() {
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [places, setPlaces] = useState<AdminPlace[]>([]);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setPlaces(await adminListPlaces()); setStatus("ok"); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); setStatus("error"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // Deep-link ?edit=<nodeId> (e.g. from the Import page) opens that editor.
  useEffect(() => {
    const edit = new URLSearchParams(window.location.search).get("edit");
    if (edit) setSelectedId(edit);
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return places.filter((p) => {
      if (needle && !p.label.toLowerCase().includes(needle)) return false;
      if (filter === "restaurant") return p.entityType === "restaurant";
      if (filter === "cafe") return p.entityType === "cafe";
      if (filter === "with_photos") return p.photoCount > 0;
      if (filter === "no_details") return propCount(p) === 0;
      return true;
    });
  }, [places, q, filter]);

  const selected = places.find((p) => p.nodeId === selectedId) ?? null;

  if (selected) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-8">
        <button onClick={() => setSelectedId(null)} className="mb-4 flex items-center gap-1.5 text-[13px] text-faint hover:text-ink">
          <ChevronLeft size={15} /> All places
        </button>
        <h1 className="mb-5 text-xl font-bold text-ink" style={{ fontFamily: "var(--font-display)" }}>{selected.label}</h1>
        <PlaceEditor place={selected} onSaved={load} onDeleted={() => { setSelectedId(null); void load(); }} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink" style={{ fontFamily: "var(--font-display)" }}>Places</h1>
        <p className="mt-1 text-sm text-dim">Every restaurant &amp; café in the catalog — search, edit details, manage photos &amp; menu, or delete.</p>
      </header>

      {status === "loading" && <div className="flex items-center gap-2 text-dim"><Loader2 className="animate-spin" size={16} /> Loading…</div>}
      {status === "error" && <div className="rounded-2xl border border-line bg-surface p-6 text-sm text-rose-300">{error}</div>}

      {status === "ok" && (
        <>
          {/* controls */}
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name…"
                className="w-full rounded-lg border border-line bg-space/60 py-2 pl-9 pr-3 text-[13px] text-ink outline-none focus:border-gold/60" />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map((f) => (
                <button key={f.key} onClick={() => setFilter(f.key)}
                  className="rounded-full border px-3 py-1.5 text-[12px] transition"
                  style={filter === f.key ? { borderColor: "rgba(255,140,90,0.6)", color: "#ff8c5a", background: "rgba(255,140,90,0.08)" } : { borderColor: "var(--color-line)", color: "var(--color-dim)" }}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mb-2 text-[12px] text-faint">{filtered.length} of {places.length} places</div>

          {/* table */}
          <div className="overflow-hidden rounded-2xl border border-line bg-surface backdrop-blur-md">
            <div className="hidden grid-cols-[1fr_120px_90px_90px] gap-3 border-b border-line px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-wider text-faint sm:grid">
              <span>Name</span><span>Cuisine</span><span className="text-center">Content</span><span className="text-right">Source</span>
            </div>
            <ul className="divide-y divide-line">
              {filtered.map((p) => {
                const cuisine = Array.isArray(p.properties?.cuisine) ? (p.properties!.cuisine as string[]) : [];
                const src = typeof p.properties?.source === "string" ? p.properties.source : "—";
                return (
                  <li key={p.nodeId}>
                    <button onClick={() => setSelectedId(p.nodeId)}
                      className="grid w-full grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 text-left transition hover:bg-white/[0.03] sm:grid-cols-[1fr_120px_90px_90px]">
                      <span className="min-w-0">
                        <span className="block truncate text-[13.5px] font-medium text-ink">{p.label}</span>
                        <span className="text-[11px] capitalize text-faint">{p.entityType}{propCount(p) === 0 ? " · needs details" : ""}</span>
                      </span>
                      <span className="hidden truncate text-[12px] capitalize text-dim sm:block">{cuisine.slice(0, 2).join(", ") || "—"}</span>
                      <span className="hidden items-center justify-center gap-2 text-[11px] text-faint sm:flex">
                        {p.photoCount > 0 && <span className="inline-flex items-center gap-0.5"><ImageIcon size={12} /> {p.photoCount}</span>}
                        {p.menuCount > 0 && <span className="inline-flex items-center gap-0.5"><UtensilsCrossed size={12} /> {p.menuCount}</span>}
                        {p.photoCount === 0 && p.menuCount === 0 && "—"}
                      </span>
                      <span className="hidden items-center justify-end gap-2 text-right text-[11px] uppercase tracking-wider text-faint sm:flex">
                        {src}<ChevronRight size={14} />
                      </span>
                      <ChevronRight size={16} className="text-faint sm:hidden" />
                    </button>
                  </li>
                );
              })}
              {filtered.length === 0 && <li className="px-4 py-8 text-center text-[13px] text-faint">No places match.</li>}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
