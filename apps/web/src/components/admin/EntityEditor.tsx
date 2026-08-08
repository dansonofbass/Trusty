"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Trash2, ImageIcon, GitBranch, X, Plus, ArrowRight, ArrowLeft, Loader2, Copy, ExternalLink } from "lucide-react";
import type { FieldDef } from "@constellation/graph-core";
import {
  updateEntityAdmin, deleteEntityAdmin, nodeRelations, addRelation, removeRelation, listEntities,
  type EntityRow, type NodeRelation, type AvailableRelation,
} from "@/lib/adminEntitiesClient";
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
        <span className={label}>{f.label}{set.size ? ` · ${set.size}` : ""}</span>
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
  return (
    <div>
      <span className={label}>{f.label}{f.unit ? ` (${f.unit})` : ""}</span>
      <input className={input} type={f.type === "number" || f.type === "money" ? "number" : "text"}
        value={String(value ?? "")} placeholder={f.placeholder}
        onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)} />
    </div>
  );
}

const cardCls = "rounded-2xl border border-line bg-surface backdrop-blur-md p-5";

/** Entity types that carry a specialist profile at /s/[id] (mirror of graph-core's list). */
const SPECIALIST_TYPES = new Set([
  "lawyer", "broker", "immigration_consultant", "accountant", "doctor",
  "dentist", "mechanic", "plumber", "electrician",
]);

/** Add / list / remove ontology relations (MEMBER_OF, ADVISES, …) for a node. */
function RelationsSection({ nodeId }: { nodeId: string }) {
  const [relations, setRelations] = useState<NodeRelation[]>([]);
  const [available, setAvailable] = useState<AvailableRelation[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [pick, setPick] = useState(0); // index into `available`
  const [candidates, setCandidates] = useState<{ id: string; label: string; entityType?: string }[]>([]);
  const [q, setQ] = useState("");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await nodeRelations(nodeId); setRelations(r.relations); setAvailable(r.available); }
    catch { /* ignore */ } finally { setLoading(false); }
  }, [nodeId]);
  useEffect(() => { void load(); }, [load]);

  const sel = available[pick];
  // load candidate nodes of the allowed other-side type(s) when the relation changes
  useEffect(() => {
    if (!adding || !sel) return;
    const single = sel.otherTypes.length === 1 && sel.otherTypes[0] !== "*" ? sel.otherTypes[0] : "";
    listEntities({ type: single })
      .then((r) => {
        const wildcard = sel.otherTypes.includes("*");
        setCandidates(r.nodes
          .filter((n) => n.id !== nodeId && (single || wildcard || (n.entityType && sel.otherTypes.includes(n.entityType))))
          .map((n) => ({ id: n.id, label: n.label, entityType: n.entityType })));
      })
      .catch(() => setCandidates([]));
    setTarget(""); setQ("");
  }, [adding, pick, sel, nodeId]);

  const filtered = useMemo(
    () => (q ? candidates.filter((c) => c.label.toLowerCase().includes(q.toLowerCase())) : candidates).slice(0, 50),
    [candidates, q],
  );

  const add = async () => {
    if (!sel || !target) return;
    setBusy(true); setErr(null);
    try {
      const source = sel.direction === "out" ? nodeId : target;
      const tgt = sel.direction === "out" ? target : nodeId;
      await addRelation({ relationId: sel.relationId, source, target: tgt });
      setAdding(false); await load();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const drop = async (edgeId: string) => {
    setRelations((rs) => rs.filter((r) => r.edgeId !== edgeId));
    try { await removeRelation(edgeId); } catch { void load(); }
  };

  return (
    <section className={cardCls}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-[13px] font-semibold text-ink"><GitBranch size={15} className="text-faint" /> Relations · {relations.length}</h3>
        {available.length > 0 && (
          <button onClick={() => { setAdding((v) => !v); setPick(0); }} className="flex items-center gap-1 text-[12px] text-faint hover:text-ink"><Plus size={13} /> Add</button>
        )}
      </div>

      {adding && sel && (
        <div className="mb-3 space-y-2 rounded-xl border border-line bg-space/40 p-3">
          <select value={pick} onChange={(e) => setPick(Number(e.target.value))} className={input}>
            {available.map((a, i) => (
              <option key={i} value={i}>{a.label} {a.direction === "out" ? "→" : "←"} {a.otherTypes.join("/")}</option>
            ))}
          </select>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="search target…" className={input} />
          <select value={target} onChange={(e) => setTarget(e.target.value)} size={Math.min(6, Math.max(2, filtered.length))} className={`${input} h-auto`}>
            {filtered.map((c) => <option key={c.id} value={c.id}>{c.label}{c.entityType ? ` · ${c.entityType}` : ""}</option>)}
            {filtered.length === 0 && <option disabled>no candidates</option>}
          </select>
          {err && <p className="text-[12px] text-rose-300">{err}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={() => setAdding(false)} className="rounded-lg border border-line px-3 py-1 text-[12px] text-dim">Cancel</button>
            <button onClick={() => void add()} disabled={busy || !target} className="rounded-lg bg-gold px-3 py-1 text-[12px] font-semibold text-space disabled:opacity-50">Add relation</button>
          </div>
        </div>
      )}

      {loading ? (
        <Loader2 className="animate-spin text-faint" size={16} />
      ) : relations.length === 0 ? (
        <p className="text-[13px] text-faint">No relations yet{available.length ? " — add one above." : "."}</p>
      ) : (
        <ul className="divide-y divide-line">
          {relations.map((r) => (
            <li key={r.edgeId} className="flex items-center gap-2 py-2 text-[13px]">
              <span className="rounded-full border border-line px-2 py-0.5 text-[10.5px] uppercase tracking-wider text-dim">{r.label}</span>
              {r.direction === "out" ? <ArrowRight size={13} className="text-faint" /> : <ArrowLeft size={13} className="text-faint" />}
              <span className="min-w-0 flex-1 truncate text-ink">{r.otherLabel}</span>
              {r.otherType && <span className="text-[11px] text-faint">{r.otherType}</span>}
              <button onClick={() => void drop(r.edgeId)} aria-label="Remove" className="text-faint hover:text-rose-300"><X size={14} /></button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function EntityEditor({ row, fields, onSaved, onDeleted }: { row: EntityRow; fields: FieldDef[]; onSaved: () => void; onDeleted: () => void }) {
  const [label0, setLabel0] = useState(row.label);
  const [props, setProps] = useState<Record<string, unknown>>({ ...(row.properties ?? {}) });
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const photos = row.photos ?? [];

  const save = async () => {
    setSaving(true); setError(null);
    try {
      await updateEntityAdmin(row.id, { label: label0, properties: props });
      setSavedAt(new Date().toLocaleTimeString());
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  };
  const del = async () => {
    if (!confirm(`Delete "${row.label}"? This can't be undone.`)) return;
    try { await deleteEntityAdmin(row.id); onDeleted(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <span className={label}>Name</span>
          <input className={`${input} text-[15px] font-semibold`} value={label0} onChange={(e) => setLabel0(e.target.value)} />
        </div>
        <span className="mt-5 rounded-full border border-line px-2.5 py-1 text-[11px] uppercase tracking-wider text-dim">{row.entityType ?? row.type}</span>
        {row.app && <span className="mt-5 rounded-full border border-line px-2.5 py-1 text-[11px] uppercase tracking-wider text-faint">{row.app}</span>}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-[12px] text-faint">
        <button
          onClick={() => void navigator.clipboard.writeText(row.id)}
          className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 hover:text-ink"
          title="Copy node ID"
        >
          <Copy size={12} /> {row.id}
        </button>
        {SPECIALIST_TYPES.has(row.entityType ?? "") && (
          <a
            href={`/s/${encodeURIComponent(row.id)}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 hover:text-ink"
          >
            <ExternalLink size={12} /> View public profile
          </a>
        )}
      </div>

      <section className={cardCls}>
        {fields.length === 0 ? (
          <p className="text-[13px] text-faint">This node has no editable schema (a person with no role). You can rename it above.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {fields.map((f) => (
              <div key={f.key} className={f.type === "multiselect" && (f.options?.length ?? 0) > 8 ? "sm:col-span-2" : ""}>
                <Field f={f} value={props[f.key]} onChange={(v) => setProps((p) => ({ ...p, [f.key]: v }))} />
              </div>
            ))}
          </div>
        )}
        {error && <p className="mt-3 text-sm text-rose-300">{error}</p>}
        <div className="mt-5 flex items-center gap-3">
          <button onClick={save} disabled={saving} className="rounded-lg bg-gold px-5 py-2 font-semibold text-space disabled:opacity-50">{saving ? "Saving…" : "Save changes"}</button>
          {savedAt && <span className="text-xs text-faint">Saved at {savedAt}</span>}
          <button onClick={() => void del()} className="ml-auto flex items-center gap-1.5 rounded-lg border border-rose-400/40 px-4 py-2 text-[13px] text-rose-300 hover:bg-rose-400/10">
            <Trash2 size={14} /> Delete
          </button>
        </div>
      </section>

      <RelationsSection nodeId={row.id} />

      {photos.length > 0 && (
        <section className={cardCls}>
          <h3 className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-ink"><ImageIcon size={15} className="text-faint" /> Photos · {photos.length}</h3>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {photos.map((src, k) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={src} src={src} alt="" onClick={() => setLightbox(k)} className="aspect-square cursor-zoom-in rounded-lg object-cover" />
            ))}
          </div>
        </section>
      )}

      {lightbox !== null && photos.length > 0 && <Lightbox photos={photos} startIndex={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}
