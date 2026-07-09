"use client";

import { useEffect, useState } from "react";
import { Clock, Navigation, MapPin, ChevronRight, Check, Bookmark, Megaphone } from "lucide-react";
import type { GNode } from "@constellation/graph-core";
import { isOpenNow } from "@constellation/graph-core";
import { TRUST_ACCENT, GOLD, withAlpha } from "@/lib/palette";
import { placeDetail, setSaved, type PlaceDetail as PlaceDetailT } from "@/lib/placesClient";
import { markIntent } from "@/lib/outcomeClient";
import { createAsk } from "@/lib/asksClient";
import { useUI } from "@/lib/store";
import TrustButton from "./TrustButton";

/**
 * Restaurant/cafe QUICK PEEK — the compact panel/sheet view. Shows just enough
 * to decide (identity, open-now, network trust, key actions) and a prominent
 * "View full details" that opens the full-screen {@link PlaceModal} with the
 * complete TripAdvisor-style experience (hours, features, menu, photos, reviews).
 */
const asArr = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);
const asStr = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);

export default function PlaceDetail({
  node,
  coords,
}: {
  node: GNode;
  coords?: { lat: number; lng: number } | null;
  /** Kept for call-site compatibility; navigation now happens in the modal. */
  onJump?: (id: string) => void;
}) {
  const openPlace = useUI((s) => s.openPlace);
  const [detail, setDetail] = useState<PlaceDetailT | null>(null);
  const [saved, setSavedState] = useState<boolean | null>(null);
  const [asked, setAsked] = useState(false);
  const [intended, setIntended] = useState(false);

  useEffect(() => {
    let live = true;
    placeDetail(node.id, coords ?? undefined)
      .then((d) => {
        if (!live) return;
        setDetail(d);
        setSavedState(Boolean(d.saved));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [node.id, coords]);

  const props = node.properties ?? {};
  const cuisine = asArr(props.cuisine).map((c) => c.replace(/_/g, " "));
  const price = asStr(props.price_range);
  const hours = asStr(props.hours);
  const geo = asStr(props.geo);
  const topic = detail?.topic ?? "restaurant";
  const open = hours ? isOpenNow(hours, new Date()) : null;
  const mapsUrl =
    typeof node.lat === "number" && typeof node.lng === "number"
      ? `https://www.google.com/maps/search/?api=1&query=${node.lat},${node.lng}`
      : undefined;
  const meta = [cuisine.slice(0, 3).join(", "), price].filter(Boolean).join(" · ");
  const pct = detail ? Math.round(Math.min(1, detail.trust.score) * 100) : 0;

  const toggleSave = async () => {
    const next = !saved;
    setSavedState(next);
    try { await setSaved(node.id, next); } catch { setSavedState(!next); }
  };
  const useThis = async () => {
    setIntended(true);
    try { await markIntent({ nodeId: node.id, topic, geo }); } catch { setIntended(false); }
  };
  const ask = async () => {
    try { await createAsk({ topic, geo }); setAsked(true); } catch { /* ignore */ }
  };

  return (
    <div className="space-y-3.5">
      {/* identity meta */}
      {(meta || detail?.distanceKm != null || open !== null) && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-dim">
          {meta && <span>{meta}</span>}
          {detail?.distanceKm != null && (
            <span className="inline-flex items-center gap-0.5" style={{ color: TRUST_ACCENT }}>
              <MapPin size={11} /> {detail.distanceKm} km
            </span>
          )}
          {open !== null && (
            <span className="inline-flex items-center gap-1">
              <Clock size={11} className="text-faint" />
              <b style={{ color: open ? "#4ade80" : "#f87171" }}>{open ? "Open now" : "Closed"}</b>
            </span>
          )}
        </div>
      )}

      {/* network trust (compact) */}
      <section className="rounded-xl border border-line bg-space/40 p-3">
        <div className="eyebrow mb-2" style={{ color: TRUST_ACCENT }}>What your network says</div>
        {!detail ? (
          <p className="text-[12.5px] text-faint">Loading trust…</p>
        ) : detail.trust.count === 0 ? (
          <p className="text-[12.5px] text-dim">No one in your network trusts this yet — be the first to vouch.</p>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: TRUST_ACCENT }} />
              </div>
              <span className="shrink-0 text-[11px] uppercase tracking-wider text-faint">Trust {pct}% · {detail.trust.count}</span>
            </div>
            {detail.trust.because.length > 1 && (
              <div className="flex flex-wrap items-center gap-x-1 text-[12px]">
                {detail.trust.because.map((name, i) => (
                  <span key={i} className="flex items-center gap-1">
                    {i > 0 && <ChevronRight size={11} className="text-faint" />}
                    <span className={i === detail.trust.because.length - 1 ? "font-medium text-ink" : "text-dim"}>{name}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* View full details → the TripAdvisor-grade modal */}
      <button
        type="button"
        onClick={() => openPlace(node.id)}
        className="flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-[13px] font-bold text-space"
        style={{ background: TRUST_ACCENT, fontFamily: "var(--font-display)" }}
      >
        View full details <ChevronRight size={15} />
      </button>

      {/* key actions */}
      <div className="space-y-2">
        <TrustButton targetId={node.id} targetLabel={node.label} nodeType={node.type} />
        <div className="grid grid-cols-2 gap-2">
          <button onClick={useThis} disabled={intended}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-line py-2 text-[12.5px] text-ink disabled:opacity-60">
            {intended ? <Check size={13} style={{ color: TRUST_ACCENT }} /> : null}{intended ? "Noted" : "I'll go here"}
          </button>
          <button onClick={ask} disabled={asked}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-line py-2 text-[12.5px] text-ink disabled:opacity-60">
            <Megaphone size={13} /> {asked ? "Asked" : "Ask network"}
          </button>
          <button onClick={toggleSave} aria-pressed={!!saved}
            className="flex items-center justify-center gap-1.5 rounded-lg border py-2 text-[12.5px]"
            style={saved ? { borderColor: withAlpha(GOLD, 0.5), color: GOLD, background: withAlpha(GOLD, 0.08) } : { borderColor: "var(--color-line)", color: "var(--color-ink)" }}>
            <Bookmark size={13} fill={saved ? GOLD : "none"} /> {saved ? "Saved" : "Save"}
          </button>
          {mapsUrl && (
            <a href={mapsUrl} target="_blank" rel="noreferrer"
              className="flex items-center justify-center gap-1.5 rounded-lg border border-line py-2 text-[12.5px] text-ink">
              <Navigation size={13} /> Directions
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
