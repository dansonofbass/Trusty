"use client";

import { useEffect, useState } from "react";
import { Trash2, X, ImageIcon, UtensilsCrossed, MapPin, Clock, Phone, Globe, Loader2 } from "lucide-react";
import { entityTypeById, type FieldDef } from "@constellation/graph-core";
import {
  adminUpdatePlace, adminDeletePlace, placeDetail, removePlacePhoto, removeMenuItem,
  type AdminPlace, type MenuItem,
} from "@/lib/placesClient";
import Lightbox from "@/components/Lightbox";

const label = "block text-[11px] font-semibold uppercase tracking-[0.16em] text-faint mb-1.5";
const input = "w-full rounded-lg border border-line bg-space/60 px-3 py-2 text-[13px] text-ink outline-none focus:border-gold/60";
const asArr = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);

function Field({ f, value, onChange }: { f: FieldDef; value: unknown; onChange: (v: unknown) => void }) {
  if (f.type === "boolean") {
    return (
      <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-space/40 px-3 py-2 text-[13px] text-ink">
        <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-[var(--color-gold)]" />
        {f.label}
      </label>
    );
  }
  if (f.type === "select") {
    return (
      <div>
        <span className={label}>{f.label}</span>
        <select value={String(value ?? "")} onChange={(e) => onChange(e.target.value || undefined)} className={input}>
          <option value="">—</option>
          {f.options?.map((o) => <option key={o} value={o}>{o.replace(/_/g, " ")}</option>)}
        </select>
      </div>
    );
  }
  if (f.type === "multiselect") {
    const set = new Set(asArr(value));
    return (
      <div>
        <span className={label}>{f.label}{set.size > 0 ? ` · ${set.size}` : ""}</span>
        <div className="flex flex-wrap gap-1.5">
          {(f.options ?? []).map((o) => {
            const on = set.has(o);
            return (
              <button key={o} type="button"
                onClick={() => { const n = new Set(set); if (on) n.delete(o); else n.add(o); onChange([...n]); }}
                className="rounded-full border px-2.5 py-1 text-[11px] transition"
                style={{ borderColor: on ? "rgba(255,140,90,0.6)" : "var(--color-line)", color: on ? "var(--color-ink)" : "var(--color-faint)", background: on ? "rgba(255,140,90,0.08)" : "transparent" }}>
                {o.replace(/_/g, " ")}
              </button>
            );
          })}
        </div>
      </div>
    );
  }
  const icon = f.key === "address" ? <MapPin size={13} /> : f.key === "hours" ? <Clock size={13} /> : f.key === "phone" ? <Phone size={13} /> : f.key === "website" ? <Globe size={13} /> : null;
  return (
    <div>
      <span className={label}>{f.label}{f.unit ? ` (${f.unit})` : ""}</span>
      <div className="relative">
        {icon && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint">{icon}</span>}
        <input className={`${input} ${icon ? "pl-8" : ""}`} type={f.type === "number" || f.type === "money" ? "number" : "text"}
          value={String(value ?? "")} placeholder={f.placeholder}
          onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)} />
      </div>
    </div>
  );
}

const cardCls = "rounded-2xl border border-line bg-surface backdrop-blur-md p-5";

export default function PlaceEditor({ place, onSaved, onDeleted }: { place: AdminPlace; onSaved: () => void; onDeleted: () => void }) {
  const def = place.entityType ? entityTypeById(place.entityType) : undefined;
  const [label0, setLabel0] = useState(place.label);
  const [props, setProps] = useState<Record<string, unknown>>({ ...(place.properties ?? {}) });
  const [photos, setPhotos] = useState<string[]>(place.photos ?? []);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [menuLoading, setMenuLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<number | null>(null);

  useEffect(() => {
    setMenuLoading(true);
    placeDetail(place.nodeId).then((d) => setMenu(d.menu ?? [])).catch(() => undefined).finally(() => setMenuLoading(false));
  }, [place.nodeId]);

  if (!def) return <p className="text-sm text-dim">Unknown entity type.</p>;

  const save = async () => {
    setSaving(true); setError(null);
    try {
      await adminUpdatePlace(place.nodeId, { label: label0, properties: props });
      setSavedAt(new Date().toLocaleTimeString());
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  };
  const del = async () => {
    if (!confirm(`Delete "${place.label}" and its menu? This can't be undone.`)) return;
    try { await adminDeletePlace(place.nodeId); onDeleted(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const dropPhoto = async (url: string) => {
    setPhotos((p) => p.filter((x) => x !== url));
    try { await removePlacePhoto(place.nodeId, url); onSaved(); } catch { /* ignore */ }
  };
  const dropDish = async (dishId: string) => {
    setMenu((m) => m.filter((x) => x.nodeId !== dishId));
    try { await removeMenuItem(place.nodeId, dishId); onSaved(); } catch { /* ignore */ }
  };

  return (
    <div className="space-y-5">
      {/* header */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <span className={label}>Name</span>
          <input className={`${input} text-[15px] font-semibold`} value={label0} onChange={(e) => setLabel0(e.target.value)} />
        </div>
        <span className="mt-5 rounded-full border border-line px-2.5 py-1 text-[11px] uppercase tracking-wider text-dim">{place.entityType}</span>
        {typeof place.properties?.source === "string" && (
          <span className="mt-5 rounded-full border border-line px-2.5 py-1 text-[11px] uppercase tracking-wider text-faint">{String(place.properties.source)}</span>
        )}
      </div>

      {/* fields */}
      <section className={cardCls}>
        <div className="grid gap-4 sm:grid-cols-2">
          {def.fields.map((f) => (
            <div key={f.key} className={f.type === "multiselect" && (f.options?.length ?? 0) > 8 ? "sm:col-span-2" : ""}>
              <Field f={f} value={props[f.key]} onChange={(v) => setProps((p) => ({ ...p, [f.key]: v }))} />
            </div>
          ))}
        </div>
        {error && <p className="mt-3 text-sm text-rose-300">{error}</p>}
        <div className="mt-5 flex items-center gap-3">
          <button onClick={save} disabled={saving} className="rounded-lg bg-gold px-5 py-2 font-semibold text-space disabled:opacity-50">{saving ? "Saving…" : "Save changes"}</button>
          {savedAt && <span className="text-xs text-faint">Saved at {savedAt}</span>}
          <button onClick={() => void del()} className="ml-auto flex items-center gap-1.5 rounded-lg border border-rose-400/40 px-4 py-2 text-[13px] text-rose-300 hover:bg-rose-400/10">
            <Trash2 size={14} /> Delete place
          </button>
        </div>
      </section>

      {/* photos */}
      <section className={cardCls}>
        <h3 className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-ink"><ImageIcon size={15} className="text-faint" /> Photos · {photos.length}</h3>
        {photos.length === 0 ? (
          <p className="text-[13px] text-faint">No photos.</p>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {photos.map((src, k) => (
              <div key={src} className="group relative aspect-square overflow-hidden rounded-lg">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="" onClick={() => setLightbox(k)} className="h-full w-full cursor-zoom-in object-cover" />
                <button onClick={() => void dropPhoto(src)} aria-label="Remove photo"
                  className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-rose-300 opacity-0 transition group-hover:opacity-100 hover:bg-black/80">
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* menu */}
      <section className={cardCls}>
        <h3 className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-ink"><UtensilsCrossed size={15} className="text-faint" /> Menu · {menu.length}</h3>
        {menuLoading ? (
          <Loader2 className="animate-spin text-faint" size={16} />
        ) : menu.length === 0 ? (
          <p className="text-[13px] text-faint">No dishes.</p>
        ) : (
          <ul className="divide-y divide-line">
            {menu.map((m) => (
              <li key={m.nodeId} className="flex items-center gap-3 py-2">
                {m.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.image} alt="" className="h-9 w-9 shrink-0 rounded-md object-cover" />
                )}
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{m.label}</span>
                {m.price && <span className="text-[13px] text-dim">{m.price}</span>}
                <button onClick={() => void dropDish(m.nodeId)} aria-label="Remove dish" className="text-faint hover:text-rose-300"><Trash2 size={14} /></button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {lightbox !== null && photos.length > 0 && (
        <Lightbox photos={photos} startIndex={lightbox} onClose={() => setLightbox(null)} />
      )}
    </div>
  );
}
