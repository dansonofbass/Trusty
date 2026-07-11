"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, ChevronRight, ChevronLeft, Loader2, Plus, Upload, Download, X, Users, Boxes } from "lucide-react";
import {
  entitiesSchema, listEntities, exportEntities, importEntities, createEntityAdmin,
  type EntityRow, type EntitiesSchema, type SchemaType, type ImportRow,
} from "@/lib/adminEntitiesClient";
import EntityEditor from "@/components/admin/EntityEditor";

const input = "w-full rounded-lg border border-line bg-space/60 px-3 py-2 text-[13px] text-ink outline-none focus:border-gold/60";

function downloadJSON(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

export default function EntitiesPage() {
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [schema, setSchema] = useState<EntitiesSchema>({ apps: [], entityTypes: [] });
  const [rows, setRows] = useState<EntityRow[]>([]);
  const [app, setApp] = useState("");        // "" = all apps
  const [type, setType] = useState("");       // "" = all, "person", or an entityType id
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modal, setModal] = useState<null | "new" | "import">(null);

  const loadSchema = useCallback(async () => {
    try { setSchema(await entitiesSchema()); } catch (e) { setError(e instanceof Error ? e.message : String(e)); setStatus("error"); }
  }, []);
  const load = useCallback(async () => {
    try { const r = await listEntities({ app, type, q }); setRows(r.nodes); setStatus("ok"); }
    catch (e) { const m = e instanceof Error ? e.message : String(e); if (/403/.test(m)) return setStatus("error"); setError(m); setStatus("error"); }
  }, [app, type, q]);

  useEffect(() => { void loadSchema(); }, [loadSchema]);
  useEffect(() => { const t = setTimeout(() => void load(), q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);

  // entity types available for the selected app (+ counts computed from rows)
  const typesForApp = useMemo(
    () => schema.entityTypes.filter((t) => !app || t.app === app),
    [schema, app],
  );
  const selected = rows.find((r) => r.id === selectedId) ?? null;
  const fieldsFor = (etype?: string) => schema.entityTypes.find((t) => t.id === etype)?.fields ?? [];

  const doExport = async () => {
    const data = await exportEntities({ app, type });
    downloadJSON(`entities-${app || "all"}-${type || "all"}.json`, data);
  };

  if (selected) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-8">
        <button onClick={() => setSelectedId(null)} className="mb-4 flex items-center gap-1.5 text-[13px] text-faint hover:text-ink"><ChevronLeft size={15} /> All</button>
        <h1 className="mb-5 text-xl font-bold text-ink" style={{ fontFamily: "var(--font-display)" }}>{selected.label}</h1>
        <EntityEditor row={selected} fields={fieldsFor(selected.entityType)} onSaved={load} onDeleted={() => { setSelectedId(null); void load(); }} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-ink" style={{ fontFamily: "var(--font-display)" }}>People &amp; Entities</h1>
          <p className="mt-1 text-sm text-dim">Every node across apps — filter by app &amp; type, edit or delete, and bulk import / export.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setModal("new")} className="flex items-center gap-1.5 rounded-lg bg-gold px-3.5 py-2 text-[13px] font-semibold text-space"><Plus size={15} /> New</button>
          <button onClick={() => setModal("import")} className="flex items-center gap-1.5 rounded-lg border border-line px-3.5 py-2 text-[13px] text-ink hover:border-gold/50"><Upload size={15} /> Import</button>
          <button onClick={() => void doExport()} className="flex items-center gap-1.5 rounded-lg border border-line px-3.5 py-2 text-[13px] text-ink hover:border-gold/50"><Download size={15} /> Export</button>
        </div>
      </header>

      {status === "error" && <div className="rounded-2xl border border-line bg-surface p-6 text-sm text-rose-300">{error ?? "Failed to load."}</div>}

      {status !== "error" && (
        <>
          {/* app + search */}
          <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center">
            <select value={app} onChange={(e) => { setApp(e.target.value); setType(""); setSelectedId(null); }} className="rounded-lg border border-line bg-space/60 px-3 py-2 text-[13px] text-ink outline-none focus:border-gold/60">
              <option value="">All apps</option>
              {schema.apps.map((a) => <option key={a.slug} value={a.slug}>{a.label}</option>)}
            </select>
            <div className="relative flex-1">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name…" className={`${input} pl-9`} />
            </div>
          </div>

          {/* type chips */}
          <div className="mb-4 flex flex-wrap gap-1.5">
            <TypeChip active={type === ""} onClick={() => setType("")} icon={<Boxes size={13} />} label="All" />
            <TypeChip active={type === "person"} onClick={() => setType("person")} icon={<Users size={13} />} label="People" />
            {typesForApp.map((t) => <TypeChip key={t.id} active={type === t.id} onClick={() => setType(t.id)} label={t.label} />)}
          </div>

          {status === "loading" ? (
            <div className="flex items-center gap-2 text-dim"><Loader2 className="animate-spin" size={16} /> Loading…</div>
          ) : (
            <>
              <div className="mb-2 text-[12px] text-faint">{rows.length} node{rows.length === 1 ? "" : "s"}</div>
              <div className="overflow-hidden rounded-2xl border border-line bg-surface backdrop-blur-md">
                <ul className="divide-y divide-line">
                  {rows.map((r) => (
                    <li key={r.id}>
                      <button onClick={() => setSelectedId(r.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-white/[0.03]">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13.5px] font-medium text-ink">{r.label}{r.isMe ? " (you)" : ""}</span>
                          {r.sub && <span className="block truncate text-[11px] text-faint">{r.sub}</span>}
                        </span>
                        <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-[10.5px] uppercase tracking-wider text-dim">{r.entityType ?? r.type}</span>
                        {r.app && <span className="hidden shrink-0 text-[10.5px] uppercase tracking-wider text-faint sm:inline">{r.app}</span>}
                        <ChevronRight size={16} className="shrink-0 text-faint" />
                      </button>
                    </li>
                  ))}
                  {rows.length === 0 && <li className="px-4 py-8 text-center text-[13px] text-faint">No matching nodes.</li>}
                </ul>
              </div>
            </>
          )}
        </>
      )}

      {modal === "new" && <NewModal types={typesForApp.length ? typesForApp : schema.entityTypes} onClose={() => setModal(null)} onCreated={(id) => { setModal(null); void load(); setSelectedId(id); }} />}
      {modal === "import" && <ImportModal onClose={() => setModal(null)} onDone={() => { setModal(null); void load(); }} />}
    </div>
  );
}

function TypeChip({ active, onClick, label, icon }: { active: boolean; onClick: () => void; label: string; icon?: React.ReactNode }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] transition"
      style={active ? { borderColor: "rgba(255,140,90,0.6)", color: "#ff8c5a", background: "rgba(255,140,90,0.08)" } : { borderColor: "var(--color-line)", color: "var(--color-dim)" }}>
      {icon}{label}
    </button>
  );
}

function NewModal({ types, onClose, onCreated }: { types: SchemaType[]; onClose: () => void; onCreated: (id: string) => void }) {
  const [etype, setEtype] = useState(types[0]?.id ?? "");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const create = async () => {
    if (!etype || !label.trim()) return;
    setBusy(true); setErr(null);
    try { onCreated(await createEntityAdmin({ entityType: etype, label: label.trim(), properties: {} })); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title="New entity" onClose={onClose}>
      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-faint">Type</label>
      <select value={etype} onChange={(e) => setEtype(e.target.value)} className={`${input} mb-3`}>
        {types.map((t) => <option key={t.id} value={t.id}>{t.label} · {t.app}</option>)}
      </select>
      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-faint">Name</label>
      <input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void create()} className={`${input} mb-3`} placeholder="e.g. Acme Inc." />
      {err && <p className="mb-2 text-sm text-rose-300">{err}</p>}
      <button onClick={() => void create()} disabled={busy || !label.trim() || !etype} className="w-full rounded-lg bg-gold px-4 py-2 font-semibold text-space disabled:opacity-50">{busy ? "Creating…" : "Create + edit"}</button>
      <p className="mt-2 text-[11px] text-faint">Creates the node, then opens its editor to fill in fields.</p>
    </Modal>
  );
}

function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = async () => {
    setBusy(true); setErr(null); setResult(null);
    try {
      const parsed = JSON.parse(text);
      const rows: ImportRow[] = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.rows) ? parsed.rows : [];
      if (!rows.length) throw new Error("expected a JSON array of {entityType,label,properties}");
      const r = await importEntities(rows);
      setResult(`Imported ${r.created}${r.errors?.length ? `, ${r.errors.length} errors` : ""}.`);
      if (r.created) setTimeout(onDone, 900);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const onFile = async (file?: File) => { if (file) setText(await file.text()); };
  return (
    <Modal title="Bulk import" onClose={onClose}>
      <p className="mb-2 text-[12.5px] text-dim">Paste (or upload) a JSON array — the same shape Export produces:</p>
      <pre className="mb-2 overflow-x-auto rounded-lg bg-space/60 p-2 text-[11px] text-faint scroll-quiet">{`[{ "entityType": "startup", "label": "Acme", "properties": { "stage": "seed" } }]`}</pre>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} placeholder="[ … ]" className={`${input} mb-2 font-mono`} />
      <div className="mb-3 flex items-center gap-2">
        <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[12px] text-dim hover:text-ink">
          <Upload size={13} /> Upload .json
          <input type="file" accept="application/json,.json" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
        </label>
      </div>
      {err && <p className="mb-2 text-sm text-rose-300">{err}</p>}
      {result && <p className="mb-2 text-sm" style={{ color: "#4ade80" }}>{result}</p>}
      <button onClick={() => void run()} disabled={busy || !text.trim()} className="w-full rounded-lg bg-gold px-4 py-2 font-semibold text-space disabled:opacity-50">{busy ? "Importing…" : "Import"}</button>
    </Modal>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative z-10 mt-16 w-full max-w-md rounded-2xl border border-line bg-surface p-5 backdrop-blur-md" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[15px] font-bold text-ink" style={{ fontFamily: "var(--font-display)" }}>{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-faint hover:text-ink"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
