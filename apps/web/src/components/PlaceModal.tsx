"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  X, Clock, Phone, Globe, Navigation, MapPin, ThumbsUp, ThumbsDown, Megaphone, Check, Bookmark,
  Plus, ChevronRight, Wifi, CreditCard, Car, Dog, Music, Tv, Wind, Beer, Wine, Utensils,
  Accessibility, CigaretteOff, Baby, Users, Truck, ShoppingBag, CalendarCheck, DoorOpen, Star, ImagePlus,
} from "lucide-react";
import { isOpenNow, weeklyHours } from "@constellation/graph-core";
import { TRUST_ACCENT, GOLD, withAlpha } from "@/lib/palette";
import {
  placeDetail, setSaved, submitMenuItem, uploadMedia, submitPlacePhoto, suggestPlaceEdit,
  type PlaceDetail as PlaceDetailT, type MenuItem,
} from "@/lib/placesClient";
import { markIntent } from "@/lib/outcomeClient";
import { createAsk } from "@/lib/asksClient";
import { useUI } from "@/lib/store";
import TrustButton from "./TrustButton";
import Lightbox from "./Lightbox";

// Client-only: maplibre touches the DOM; never render it on the server.
const PlaceMap = dynamic(() => import("./PlaceMap"), { ssr: false });

/**
 * Full-screen restaurant/cafe detail — the trust-native answer to a TripAdvisor
 * page, with room the side panel never had: photo gallery, hours by day, an
 * amenities grid, location, menu, "reasons to eat here" (your network's reasons,
 * not sponsored blurbs), community photos, and network reviews. Opened from the
 * quick-peek panel via the store's `placeModalId`.
 */

const asArr = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);
const asStr = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);
const humanize = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** Amenity code → icon (fallback = a small dot). */
const AMENITY_ICON: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  wifi: Wifi, free_wifi: Wifi, accepts_cards: CreditCard, digital_payments: CreditCard,
  parking: Car, street_parking: Car, dog_friendly: Dog, live_music: Music, tv: Tv,
  air_conditioning: Wind, full_bar: Beer, serves_alcohol: Beer, wine_beer: Wine,
  table_service: Utensils, wheelchair_accessible: Accessibility, non_smoking: CigaretteOff,
  highchairs: Baby, family_style: Users, delivery: Truck, takeaway: ShoppingBag,
  reservations: CalendarCheck, drive_through: Car, outdoor_seating: DoorOpen, private_dining: Users,
};

function AmenityRow({ code }: { code: string }) {
  const Icon = AMENITY_ICON[code] ?? MapPin;
  return (
    <div className="flex items-center gap-2 text-[13px] text-ink">
      <Icon size={15} className="shrink-0 text-dim" />
      <span>{humanize(code)}</span>
    </div>
  );
}

/** A titled block in the modal. */
function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="border-t border-line pt-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-[17px] font-semibold text-ink" style={{ fontFamily: "var(--font-display)" }}>{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

export default function PlaceModal({ id }: { id: string }) {
  const closePlace = useUI((s) => s.closePlace);
  const openPlace = useUI((s) => s.openPlace);
  const [d, setD] = useState<PlaceDetailT | null>(null);
  const [saved, setSavedState] = useState<boolean | null>(null);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [asked, setAsked] = useState(false);
  const [intended, setIntended] = useState(false);
  const [allFeatures, setAllFeatures] = useState(false);
  const [addingDish, setAddingDish] = useState(false);
  const [dishName, setDishName] = useState("");
  const [dishPrice, setDishPrice] = useState("");
  const [dishImage, setDishImage] = useState<File | null>(null);
  const [dishSubmitted, setDishSubmitted] = useState(false);
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [photoSubmitted, setPhotoSubmitted] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestHours, setSuggestHours] = useState("");
  const [suggestNote, setSuggestNote] = useState("");
  const [suggested, setSuggested] = useState(false);

  useEffect(() => {
    let live = true;
    setD(null);
    placeDetail(id)
      .then((r) => {
        if (!live) return;
        setD(r);
        setSavedState(Boolean(r.saved));
        setMenu(r.menu ?? []);
        setPhotos((r.node.photos ?? []).filter(Boolean));
      })
      .catch(() => undefined);
    return () => { live = false; };
  }, [id]);

  // Close on Escape — but not while the lightbox is open (it handles its own Esc).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && lightbox === null) closePlace(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closePlace, lightbox]);

  const props = d?.node.properties ?? {};
  const label = d?.node.label ?? "";
  const cuisine = asArr(props.cuisine).map(humanize);
  const mealTypes = asArr(props.meal_types).map(humanize);
  const amenities = asArr(props.amenities);
  const dietary = asArr(props.dietary).map(humanize);
  const goodFor = asArr(props.good_for).map(humanize);
  const price = asStr(props.price_range);
  const capacity = typeof props.capacity === "number" ? props.capacity : undefined;
  const hours = asStr(props.hours);
  const phone = asStr(props.phone);
  const website = asStr(props.website);
  const address = asStr(props.address);
  const geo = asStr(props.geo);
  const lat = d?.node.lat;
  const lng = d?.node.lng;
  const open = hours ? isOpenNow(hours, new Date()) : null;
  const week = useMemo(() => weeklyHours(hours), [hours]);
  const mapsUrl =
    typeof lat === "number" && typeof lng === "number"
      ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
      : undefined;
  const topic = d?.topic ?? "restaurant";
  const pct = d ? Math.round(Math.min(1, d.trust.score) * 100) : 0;
  const notes = (d?.trust.trusters ?? []).filter((t) => t.note);
  const topReasons = Object.entries(d?.trust.reasonTally ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const toggleSave = useCallback(async () => {
    const next = !saved;
    setSavedState(next);
    try { await setSaved(id, next); } catch { setSavedState(!next); }
  }, [saved, id]);

  const useThis = async () => {
    setIntended(true);
    try { await markIntent({ nodeId: id, topic, geo }); } catch { setIntended(false); }
  };
  const ask = async () => {
    try { await createAsk({ topic, geo }); setAsked(true); } catch { /* ignore */ }
  };
  const addDish = async () => {
    const name = dishName.trim();
    if (!name) return;
    const p = dishPrice.trim() || undefined;
    try {
      const image = dishImage ? await uploadMedia(dishImage, `menu_${id}`) : undefined;
      await submitMenuItem(id, { name, price: p, image });
      setDishName(""); setDishPrice(""); setDishImage(null); setAddingDish(false); setDishSubmitted(true);
    } catch { /* ignore */ }
  };
  const addPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const f of Array.from(files).slice(0, 8)) {
        const url = await uploadMedia(f, id);
        await submitPlacePhoto(id, url);
      }
      setPhotoSubmitted(true);
    } catch { /* ignore */ } finally { setUploading(false); }
  };
  const submitSuggestion = async () => {
    const patch: Record<string, unknown> = {};
    if (suggestHours.trim() && suggestHours.trim() !== hours) patch.hours = suggestHours.trim();
    if (!Object.keys(patch).length && !suggestNote.trim()) return;
    try {
      await suggestPlaceEdit(id, patch, suggestNote.trim() || undefined);
      setSuggested(true); setSuggesting(false);
    } catch { /* ignore */ }
  };

  const metaLine = [cuisine.slice(0, 3).join(", "), price, capacity ? `${capacity} seats` : "", geo && humanize(geo)].filter(Boolean).join(" · ");
  const shownAmenities = allFeatures ? amenities : amenities.slice(0, 9);

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto p-0 sm:p-4">
      <div className="sheet-backdrop fixed inset-0" onClick={closePlace} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="panel rise relative z-10 my-0 w-full max-w-[1080px] sm:my-4"
      >
        {/* header */}
        <div className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-line bg-surface/95 px-5 py-3 backdrop-blur-md">
          <div className="min-w-0">
            <div className="eyebrow" style={{ color: TRUST_ACCENT }}>Places</div>
            <h2 className="truncate text-[19px] font-bold text-ink" style={{ fontFamily: "var(--font-display)" }}>
              {label || "Loading…"}
            </h2>
          </div>
          <button onClick={closePlace} aria-label="Close" className="rounded-lg p-2 text-faint hover:bg-white/5 hover:text-ink">
            <X size={18} />
          </button>
        </div>

        {!d ? (
          <div className="p-10 text-center text-[13px] text-dim">Loading details…</div>
        ) : (
          <div className="grid gap-6 p-5 md:grid-cols-[1fr_320px]">
            {/* ── main column ───────────────────────────────────── */}
            <div className="min-w-0 space-y-5">
              {/* hero gallery */}
              {photos.length > 0 && (
                <div className="relative grid grid-cols-4 gap-1.5 overflow-hidden rounded-2xl" style={{ maxHeight: 320 }}>
                  <div className="col-span-2 row-span-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photos[0]} alt={label} onClick={() => setLightbox(0)} className="h-full w-full cursor-zoom-in object-cover" style={{ minHeight: 200 }} />
                  </div>
                  {photos.slice(1, 5).map((src, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={i} src={src} alt={`${label} ${i + 2}`} loading="lazy" onClick={() => setLightbox(i + 1)}
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                      className="h-full w-full cursor-zoom-in object-cover" style={{ minHeight: 98 }} />
                  ))}
                  {photos.length > 5 && (
                    <button onClick={() => setLightbox(0)} className="absolute bottom-2 right-2 rounded-full bg-black/60 px-3 py-1 text-[12px] text-white hover:bg-black/80">
                      View all {photos.length} photos
                    </button>
                  )}
                </div>
              )}

              {/* identity */}
              <div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-dim">
                  {metaLine && <span>{metaLine}</span>}
                  {d.distanceKm != null && (
                    <span className="inline-flex items-center gap-0.5" style={{ color: TRUST_ACCENT }}>
                      <MapPin size={12} /> {d.distanceKm} km
                    </span>
                  )}
                  {open !== null && (
                    <span className="inline-flex items-center gap-1">
                      <Clock size={12} className="text-faint" />
                      <b style={{ color: open ? "#4ade80" : "#f87171" }}>{open ? "Open now" : "Closed"}</b>
                    </span>
                  )}
                </div>
                {(cuisine.length > 0 || mealTypes.length > 0) && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {[...cuisine, ...mealTypes].slice(0, 8).map((c) => (
                      <span key={c} className="chip cursor-default">{c}</span>
                    ))}
                  </div>
                )}
              </div>

              {/* hours */}
              {(week.length > 0 || hours) && (
                <Section
                  title="Hours"
                  right={
                    <button
                      onClick={() => { setSuggestHours(hours ?? ""); setSuggesting((v) => !v); }}
                      className="text-[12px] text-faint hover:text-ink"
                    >
                      {suggested ? "Suggestion sent ✓" : "Suggest an edit"}
                    </button>
                  }
                >
                  {suggesting && (
                    <div className="mb-3 space-y-1.5 rounded-xl border border-line bg-space/40 p-3">
                      <input value={suggestHours} onChange={(e) => setSuggestHours(e.target.value)}
                        placeholder="e.g. Mo-Su 09:00-23:00"
                        className="w-full rounded bg-[rgba(146,166,255,0.08)] px-2 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-faint" />
                      <input value={suggestNote} onChange={(e) => setSuggestNote(e.target.value)}
                        placeholder="note (what else should change?)"
                        className="w-full rounded bg-[rgba(146,166,255,0.08)] px-2 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-faint" />
                      <div className="flex justify-end gap-2">
                        <button onClick={() => setSuggesting(false)} className="rounded border border-line px-3 py-1 text-[12px] text-dim">Cancel</button>
                        <button onClick={() => void submitSuggestion()} className="rounded px-3 py-1 text-[12px] font-semibold text-space" style={{ background: TRUST_ACCENT }}>Send to admins</button>
                      </div>
                    </div>
                  )}
                  {week.length > 0 ? (
                    <dl className="grid gap-y-1.5 text-[13px]">
                      {week.map((day) => {
                        const today = new Date().getDay(); // 0=Su
                        const isToday = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][today] === day.code;
                        return (
                          <div key={day.code} className="grid grid-cols-[110px_1fr] gap-2">
                            <dt className={isToday ? "font-semibold text-ink" : "text-dim"}>{day.label}</dt>
                            <dd className={isToday ? "text-ink" : "text-dim"}>
                              {day.ranges.length ? day.ranges.join(", ") : "Closed"}
                            </dd>
                          </div>
                        );
                      })}
                    </dl>
                  ) : (
                    <p className="text-[13px] text-dim">{hours}</p>
                  )}
                </Section>
              )}

              {/* features / amenities */}
              {(amenities.length > 0 || dietary.length > 0 || goodFor.length > 0) && (
                <Section
                  title="Features"
                  right={amenities.length > 9 ? (
                    <button onClick={() => setAllFeatures((v) => !v)} className="text-[12px] text-faint hover:text-ink">
                      {allFeatures ? "Show less" : `Show all ${amenities.length}`}
                    </button>
                  ) : undefined}
                >
                  {amenities.length > 0 && (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {shownAmenities.map((a) => <AmenityRow key={a} code={a} />)}
                    </div>
                  )}
                  {(dietary.length > 0 || goodFor.length > 0) && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {[...dietary, ...goodFor].map((t) => (
                        <span key={t} className="rounded-full border border-line px-2 py-0.5 text-[11px] text-dim">{t}</span>
                      ))}
                    </div>
                  )}
                </Section>
              )}

              {/* menu */}
              <Section
                title={`Menu${menu.length ? ` · ${menu.length}` : ""}`}
                right={
                  <button onClick={() => setAddingDish((v) => !v)} className="flex items-center gap-1 text-[12px] text-faint hover:text-ink">
                    <Plus size={13} /> Add dish
                  </button>
                }
              >
                {addingDish && (
                  <div className="mb-3 flex flex-wrap items-center gap-1.5">
                    <input value={dishName} onChange={(e) => setDishName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && void addDish()} placeholder="dish name" autoFocus
                      className="min-w-0 flex-1 rounded bg-[rgba(146,166,255,0.08)] px-2 py-1.5 text-[13px] text-ink outline-none placeholder:text-faint" />
                    <input value={dishPrice} onChange={(e) => setDishPrice(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && void addDish()} placeholder="$"
                      className="w-16 rounded bg-[rgba(146,166,255,0.08)] px-2 py-1.5 text-[13px] text-ink outline-none placeholder:text-faint" />
                    <label className="flex cursor-pointer items-center gap-1 rounded border border-line px-2 py-1.5 text-[12px] text-dim hover:text-ink">
                      <ImagePlus size={13} /> {dishImage ? "1 photo" : "Photo"}
                      <input type="file" accept="image/*" className="hidden"
                        onChange={(e) => setDishImage(e.target.files?.[0] ?? null)} />
                    </label>
                    <button onClick={() => void addDish()} disabled={!dishName.trim()}
                      className="rounded px-3 py-1.5 text-[13px] font-semibold text-space disabled:opacity-50" style={{ background: GOLD }}>Submit</button>
                  </div>
                )}
                {dishSubmitted && <p className="mb-2 text-[12px]" style={{ color: TRUST_ACCENT }}>Dish sent for review ✓</p>}
                {menu.length === 0 ? (
                  !addingDish && <p className="text-[13px] text-faint">No dishes yet — suggest the ones worth trusting.</p>
                ) : (
                  <ul className="space-y-1">
                    {menu.map((m) => (
                      <li key={m.nodeId} className="flex items-center gap-2 rounded-lg px-2 py-1.5">
                        {m.image && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={m.image} alt={m.label} loading="lazy"
                            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                            className="h-10 w-10 shrink-0 rounded-md object-cover" />
                        )}
                        <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                          {m.label}{m.description && <span className="text-faint"> — {m.description}</span>}
                        </span>
                        {m.price && <span className="shrink-0 text-[13px] text-dim">{m.price}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              {/* reasons to eat here (trust-native) */}
              {(topReasons.length > 0 || notes.length > 0) && (
                <Section title="Reasons to eat here">
                  {topReasons.length > 0 && (
                    <div className="mb-3 flex flex-wrap gap-1.5">
                      {topReasons.map(([r, n]) => (
                        <span key={r} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px]"
                          style={{ background: withAlpha(TRUST_ACCENT, 0.1), color: TRUST_ACCENT }}>
                          <Star size={11} /> {humanize(r)} · {n}
                        </span>
                      ))}
                    </div>
                  )}
                  {notes.slice(0, 3).map((t) => (
                    <div key={t.id} className="mb-2 border-l-2 border-line pl-3 text-[13px] text-dim">
                      “{t.note}” <span className="text-faint">— {t.name}</span>
                    </div>
                  ))}
                </Section>
              )}

              {/* community photos */}
              <Section
                title={`Photos${photos.length ? ` · ${photos.length}` : ""}`}
                right={
                  <label className="flex cursor-pointer items-center gap-1 text-[12px] text-faint hover:text-ink">
                    <Plus size={13} /> {uploading ? "Uploading…" : "Add photos"}
                    <input type="file" accept="image/*" multiple className="hidden"
                      disabled={uploading} onChange={(e) => void addPhotos(e.target.files)} />
                  </label>
                }
              >
                {photoSubmitted && <p className="mb-2 text-[12px]" style={{ color: TRUST_ACCENT }}>Thanks! Your photo is pending review ✓</p>}
                {photos.length === 0 ? (
                  <p className="text-[13px] text-faint">No photos yet — add the first (reviewed before it appears).</p>
                ) : (
                  <div className="flex gap-2 overflow-x-auto pb-1 scroll-quiet">
                    {photos.map((src, i) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={i} src={src} alt={`${label} ${i + 1}`} loading="lazy" onClick={() => setLightbox(i)}
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                        className="h-28 w-40 shrink-0 cursor-zoom-in rounded-xl object-cover" style={{ background: "var(--color-line)" }} />
                    ))}
                  </div>
                )}
              </Section>

              {/* network reviews */}
              {(notes.length > 0 || d.trust.outcomes.total > 0) && (
                <Section title="What your network says">
                  {d.trust.outcomes.total > 0 && (
                    <div className="mb-3 flex items-center gap-4 text-[13px] text-dim">
                      <span className="inline-flex items-center gap-1"><ThumbsUp size={13} style={{ color: "#4ade80" }} /> {d.trust.outcomes.positive}</span>
                      <span className="inline-flex items-center gap-1"><ThumbsDown size={13} style={{ color: "#f87171" }} /> {d.trust.outcomes.negative}</span>
                      <span className="text-faint">worked out?</span>
                    </div>
                  )}
                  {notes.length === 0 ? (
                    <p className="text-[13px] text-faint">No notes from your network yet.</p>
                  ) : (
                    <ul className="space-y-2.5">
                      {notes.map((t) => (
                        <li key={t.id} className="rounded-xl border border-line bg-space/40 p-3">
                          <div className="text-[13px] text-ink">“{t.note}”</div>
                          <div className="mt-1 text-[11px] text-faint">— {t.name}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                </Section>
              )}
            </div>

            {/* ── right rail ────────────────────────────────────── */}
            <aside className="space-y-4 md:sticky md:top-16 md:self-start">
              {/* trust + actions */}
              <div className="rounded-2xl border border-line bg-space/40 p-4">
                <div className="eyebrow mb-2" style={{ color: TRUST_ACCENT }}>What your network says</div>
                {d.trust.count === 0 ? (
                  <p className="text-[12.5px] text-dim">No one in your network trusts this yet — be the first to vouch.</p>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: TRUST_ACCENT }} />
                      </div>
                      <span className="shrink-0 text-[11px] uppercase tracking-wider text-faint">Trust {pct}% · {d.trust.count}</span>
                    </div>
                    {d.trust.because.length > 1 && (
                      <div className="mt-2 flex flex-wrap items-center gap-x-1 text-[12px]">
                        {d.trust.because.map((n, i) => (
                          <span key={i} className="flex items-center gap-1">
                            {i > 0 && <ChevronRight size={11} className="text-faint" />}
                            <span className={i === d.trust.because.length - 1 ? "font-medium text-ink" : "text-dim"}>{n}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </>
                )}
                <div className="mt-3">
                  <TrustButton targetId={id} targetLabel={label} nodeType="location" />
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
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

              {/* location */}
              {(address || mapsUrl) && (
                <div className="rounded-2xl border border-line bg-space/40 p-4">
                  <div className="eyebrow mb-2">Location</div>
                  {typeof lat === "number" && typeof lng === "number" && (
                    <div className="mb-3">
                      <PlaceMap lat={lat} lng={lng} label={label} />
                    </div>
                  )}
                  {address && <div className="flex items-start gap-2 text-[12.5px] text-ink"><MapPin size={14} className="mt-0.5 shrink-0 text-faint" />{address}</div>}
                  <div className="mt-2 flex flex-col gap-1.5">
                    {phone && <a href={`tel:${phone}`} className="inline-flex items-center gap-1.5 text-[12.5px] text-dim hover:text-ink"><Phone size={13} /> {phone}</a>}
                    {website && <a href={website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 truncate text-[12.5px] text-dim hover:text-ink"><Globe size={13} /> Website</a>}
                  </div>
                </div>
              )}

              {/* similar nearby */}
              {d.similar.length > 0 && (
                <div className="rounded-2xl border border-line bg-space/40 p-4">
                  <div className="eyebrow mb-2">Similar nearby</div>
                  <div className="space-y-1">
                    {d.similar.map((s) => (
                      <button key={s.nodeId} onClick={() => openPlace(s.nodeId)}
                        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-white/5">
                        <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{s.label}</span>
                        {s.distanceKm != null && <span className="shrink-0 text-[11px] text-faint">{s.distanceKm} km</span>}
                        <ChevronRight size={13} className="shrink-0 text-faint" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </aside>
          </div>
        )}
      </div>

      {lightbox !== null && photos.length > 0 && (
        <Lightbox photos={photos} startIndex={lightbox} onClose={() => setLightbox(null)} />
      )}
    </div>
  );
}
