"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  entityTypesForApp,
  relationsForApp,
  type AppDef,
  type EntityTypeDef,
  type FieldDef,
} from "@constellation/graph-core";
import { hydrateOntology } from "@/lib/ontologyClient";
import {
  listApps, saveApp, deleteApp,
  saveEntityType, deleteEntityType,
  saveRelation, deleteRelation,
  importEntities, parseImport,
  listLocationsAdmin, saveLocation, deleteLocationAdmin, type AdminLocation,
} from "@/lib/ontologyAdminClient";
import { Plus, Trash2, Boxes, Loader2, Upload, MapPin, Sparkle } from "lucide-react";
import { DEFAULT_NOTE_KINDS } from "@constellation/graph-core";

const FIELD_TYPES = ["text", "number", "money", "boolean", "select", "multiselect", "geo"] as const;

/**
 * Admin app builder — define Apps (each App = a Space = a URL namespace), and
 * within each App define entity types (with a property-field schema) and relations.
 * Everything authored here is stored data; the Sevan Summit app is built with it.
 */
export default function AppsBuilderPage() {
  const [apps, setApps] = useState<AppDef[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [version, setVersion] = useState(0); // bump to recompute registry-derived lists
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    await hydrateOntology();
    const { apps: a, enabled: en } = await listApps();
    setApps(a);
    setEnabled(en);
    setVersion((v) => v + 1);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const types = useMemo(
    () => (selected ? entityTypesForApp(selected) : []),
    [selected, version],
  );
  const rels = useMemo(() => (selected ? relationsForApp(selected) : []), [selected, version]);
  const typeIds = types.map((t) => t.id);

  const run = (p: Promise<unknown>) => {
    setErr(null);
    p.then(refresh).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  };

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center text-dim">
        <Loader2 className="animate-spin" size={18} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      <header className="mb-5 flex items-center gap-3">
        <Boxes className="text-[#ff8c5a]" size={22} />
        <div>
          <h1 className="text-xl font-bold text-ink" style={{ fontFamily: "var(--font-display)" }}>Apps &amp; Entities</h1>
          <p className="text-sm text-dim">Define apps (spaces), their entity types, and relations. Persons are shared across all apps.</p>
        </div>
      </header>

      {!enabled && (
        <p className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          The ontology store is disabled (no <code>DATABASE_URL</code> on graph-service). Apps can’t be saved.
        </p>
      )}
      {err && <p className="mb-4 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{err}</p>}

      <div className="grid gap-6 md:grid-cols-[240px_1fr]">
        {/* Apps column */}
        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-faint">Apps</div>
          <ul className="space-y-1">
            {apps.map((a) => (
              <li key={a.slug}>
                <button
                  type="button"
                  onClick={() => setSelected(a.slug)}
                  className="flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm"
                  style={selected === a.slug
                    ? { borderColor: "rgba(255,140,90,0.55)", color: "var(--color-ink)" }
                    : { borderColor: "var(--color-line)", color: "var(--color-dim)" }}
                >
                  <span>{a.label}</span>
                  <span className="text-[10px] text-faint">/{a.slug}</span>
                </button>
              </li>
            ))}
          </ul>
          <NewAppForm onSave={(input) => run(saveApp(input))} />
        </div>

        {/* Selected app detail */}
        <div>
          {!selected ? (
            <p className="text-sm text-dim">Select an app, or create one, to define its entity types and relations.</p>
          ) : (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-ink">{apps.find((a) => a.slug === selected)?.label}</h2>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(`Delete app "${selected}" and all its types/relations?`)) {
                      run(deleteApp(selected));
                      setSelected(null);
                    }
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-xs text-dim hover:border-rose-500/50 hover:text-rose-300"
                >
                  <Trash2 size={13} /> Delete app
                </button>
              </div>

              {/* Entity types */}
              <section>
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-faint">Entity types</div>
                <div className="space-y-2">
                  {types.map((t) => (
                    <div key={t.id} className="rounded-lg border border-line bg-surface/60 p-3">
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-medium text-ink">
                          {t.label} <span className="text-[11px] text-faint">· {t.baseType} · topic:{t.topic} · {t.fields.length} fields</span>
                        </div>
                        <button type="button" onClick={() => run(deleteEntityType(selected, t.id))} className="text-faint hover:text-rose-300">
                          <Trash2 size={14} />
                        </button>
                      </div>
                      {t.fields.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {t.fields.map((f) => (
                            <span key={f.key} className="rounded-full border border-line px-2 py-0.5 text-[10.5px] text-dim">
                              {f.label}<span className="text-faint"> · {f.type}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                  {types.length === 0 && <p className="text-sm text-faint">No entity types yet.</p>}
                </div>
                <EntityTypeForm onSave={(input) => run(saveEntityType(selected, input))} />
              </section>

              {/* Relations */}
              <section>
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-faint">Relations</div>
                <div className="space-y-1.5">
                  {rels.map((r) => (
                    <div key={r.id} className="flex items-center justify-between rounded-lg border border-line bg-surface/60 px-3 py-2 text-sm">
                      <span className="text-ink">
                        <span className="text-faint">{r.from.join("/")}</span> {r.label} <span className="text-faint">{r.to.join("/")}</span>
                      </span>
                      <button type="button" onClick={() => run(deleteRelation(selected, r.id))} className="text-faint hover:text-rose-300">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                  {rels.length === 0 && <p className="text-sm text-faint">No relations yet.</p>}
                </div>
                <RelationForm typeIds={typeIds} onSave={(input) => run(saveRelation(selected, input))} />
              </section>

              {/* Meeting venues */}
              <section>
                <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-faint">
                  <MapPin size={13} /> Meeting venues
                </div>
                <VenuesPanel app={selected} />
              </section>

              {/* Note-extraction entity kinds */}
              <section>
                <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-faint">
                  <Sparkle size={13} /> Note extraction kinds
                </div>
                <NoteKindsPanel
                  app={selected}
                  appLabel={apps.find((a) => a.slug === selected)?.label ?? selected}
                  current={apps.find((a) => a.slug === selected)?.config?.noteKinds as string[] | undefined}
                  onSaved={refresh}
                />
              </section>

              {/* Bulk import */}
              <section>
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-faint">Bulk import entities</div>
                <ImportPanel typeIds={typeIds} onDone={refresh} />
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** The entity kinds the AI extracts from meeting notes (config.noteKinds).
 *  Stored on the app; the composer + extraction prompts use it live. */
function NoteKindsPanel({ app, appLabel, current, onSaved }: { app: string; appLabel: string; current?: string[]; onSaved: () => void }) {
  const [kinds, setKinds] = useState<string[]>(current?.length ? current : [...DEFAULT_NOTE_KINDS]);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

  const persist = async (next: string[]) => {
    setSaving(true);
    setErr(null);
    try {
      await saveApp({ slug: app, label: appLabel, config: { noteKinds: next } });
      setKinds(next);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2 rounded-lg border border-line p-3">
      <p className="text-[11px] text-faint">
        What the AI pulls out of meeting notes (need, technology, api, …). Removing a kind hides it from extraction; custom kinds link as “interested in”.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {kinds.map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[12px] text-dim">
            {k}
            <button type="button" disabled={saving} onClick={() => void persist(kinds.filter((x) => x !== k))}
              className="text-faint hover:text-rose-300"><Trash2 size={11} /></button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && slug(draft)) { void persist([...kinds, slug(draft)]); setDraft(""); } }}
          placeholder="add a kind (e.g. food_preference)" className={inputCls} />
        <button type="button" disabled={saving || !slug(draft)}
          onClick={() => { void persist([...new Set([...kinds, slug(draft)])]); setDraft(""); }} className={btnCls}>
          <Plus size={14} /> Add
        </button>
        <button type="button" disabled={saving} onClick={() => void persist([...DEFAULT_NOTE_KINDS])}
          className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-dim hover:text-ink">
          Reset
        </button>
      </div>
      {err && <p className="text-xs text-rose-300">{err}</p>}
    </div>
  );
}

/** Predefined meeting spots offered in the 1:1 request picker (per app). */
function VenuesPanel({ app }: { app: string }) {
  const [venues, setVenues] = useState<AdminLocation[] | null>(null);
  const [label, setLabel] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    listLocationsAdmin(app).then(setVenues).catch(() => setVenues([]));
  }, [app]);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    setErr(null);
    try {
      await saveLocation(app, label.trim());
      setLabel("");
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="space-y-2 rounded-lg border border-line p-3">
      <p className="text-[11px] text-faint">Attendees pick one of these when requesting a meeting — or describe a custom spot.</p>
      <div className="flex flex-wrap gap-1.5">
        {venues === null ? (
          <Loader2 className="animate-spin text-dim" size={14} />
        ) : venues.length === 0 ? (
          <span className="text-[12px] text-faint">No venues yet.</span>
        ) : (
          venues.map((v) => (
            <span key={v.id} className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[12px] text-dim">
              {v.label}
              <button type="button" onClick={() => { void deleteLocationAdmin(v.id).then(load); }} className="text-faint hover:text-rose-300">
                <Trash2 size={11} />
              </button>
            </span>
          ))
        )}
      </div>
      <div className="flex gap-2">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && label.trim()) void add(); }}
          placeholder="e.g. Pitch tent, Lakeside, Food court"
          className={inputCls}
        />
        <button type="button" disabled={!label.trim()} onClick={() => void add()} className={btnCls}>
          <Plus size={14} /> Add
        </button>
      </div>
      {err && <p className="text-xs text-rose-300">{err}</p>}
    </div>
  );
}

function ImportPanel({ typeIds, onDone }: { typeIds: string[]; onDone: () => void }) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const doImport = async () => {
    setBusy(true);
    setResult(null);
    try {
      const rows = parseImport(text, typeIds);
      if (!rows.length) { setResult("Nothing to import."); return; }
      const r = await importEntities(rows);
      setResult(`Imported ${r.created} · ${r.errors.length} errors${r.errors.length ? ": " + r.errors.slice(0, 3).map((e) => e.label).join(", ") : ""}`);
      setText("");
      onDone();
    } catch (e) {
      setResult(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 rounded-lg border border-line p-3">
      <p className="text-[11px] text-faint">
        Paste JSON <code>{`[{"entityType":"founder","label":"Ada","properties":{"sectors":["fintech"]}}]`}</code> or CSV
        (header <code>entityType,label,…</code>; multiselect values joined by <code>|</code>).
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        placeholder={`entityType,label,sectors\nfounder,Ada Lovelace,fintech|ai`}
        className="w-full rounded-lg border border-line bg-space/60 px-3 py-2 font-mono text-[12px] text-ink outline-none focus:border-gold/60"
      />
      <div className="flex items-center gap-3">
        <button type="button" disabled={busy || !text.trim()} onClick={doImport}
          className="inline-flex items-center gap-1 rounded-lg bg-[#ff8c5a] px-3 py-1.5 text-sm font-semibold text-space disabled:opacity-50">
          <Upload size={14} /> Import
        </button>
        {result && <span className="text-xs text-dim">{result}</span>}
      </div>
    </div>
  );
}

/* ------------------------------ sub-forms ------------------------------ */

const inputCls = "w-full rounded-lg border border-line bg-space/60 px-3 py-2 text-sm text-ink outline-none focus:border-gold/60";
const btnCls = "inline-flex items-center gap-1 rounded-lg bg-[#ff8c5a] px-3 py-1.5 text-sm font-semibold text-space disabled:opacity-50";

function NewAppForm({ onSave }: { onSave: (i: { slug: string; label: string; order?: number }) => void }) {
  const [label, setLabel] = useState("");
  const [slug, setSlug] = useState("");
  return (
    <div className="mt-3 space-y-2 rounded-lg border border-line p-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">New app</div>
      <input className={inputCls} placeholder="Label (e.g. Sevan Summit)" value={label} onChange={(e) => setLabel(e.target.value)} />
      <input className={inputCls} placeholder="url slug (e.g. summit)" value={slug} onChange={(e) => setSlug(e.target.value)} />
      <button
        type="button"
        disabled={!label.trim()}
        onClick={() => { onSave({ slug: slug || label, label }); setLabel(""); setSlug(""); }}
        className={btnCls}
      >
        <Plus size={14} /> Add app
      </button>
    </div>
  );
}

function EntityTypeForm({
  onSave,
}: {
  onSave: (i: { id: string; label: string; baseType: string; topic: string; category?: string; fields: FieldDef[] }) => void;
}) {
  const [label, setLabel] = useState("");
  const [id, setId] = useState("");
  const [baseType, setBaseType] = useState("person");
  const [topic, setTopic] = useState("");
  const [category, setCategory] = useState("");
  const [fields, setFields] = useState<FieldDef[]>([]);

  const reset = () => { setLabel(""); setId(""); setTopic(""); setCategory(""); setFields([]); setBaseType("person"); };

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-line p-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">New entity type</div>
      <div className="grid grid-cols-2 gap-2">
        <input className={inputCls} placeholder="Label (e.g. Founder)" value={label} onChange={(e) => setLabel(e.target.value)} />
        <input className={inputCls} placeholder="id (e.g. founder)" value={id} onChange={(e) => setId(e.target.value)} />
        <select className={inputCls} value={baseType} onChange={(e) => setBaseType(e.target.value)}>
          <option value="person">person (individual)</option>
          <option value="location">location (org / place)</option>
        </select>
        <input className={inputCls} placeholder="trust topic (e.g. founder)" value={topic} onChange={(e) => setTopic(e.target.value)} />
        <input className={inputCls} placeholder="category / group (e.g. people)" value={category} onChange={(e) => setCategory(e.target.value)} />
      </div>
      <FieldSchemaEditor fields={fields} setFields={setFields} />
      <button
        type="button"
        disabled={!label.trim()}
        onClick={() => { onSave({ id: id || label, label, baseType, topic: topic || (id || label), category, fields }); reset(); }}
        className={btnCls}
      >
        <Plus size={14} /> Add entity type
      </button>
    </div>
  );
}

function FieldSchemaEditor({ fields, setFields }: { fields: FieldDef[]; setFields: (f: FieldDef[]) => void }) {
  const add = () => setFields([...fields, { key: "", label: "", type: "text" }]);
  const update = (i: number, patch: Partial<FieldDef>) =>
    setFields(fields.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const remove = (i: number) => setFields(fields.filter((_, j) => j !== i));

  return (
    <div className="space-y-1.5 rounded-lg border border-line/60 bg-space/40 p-2">
      <div className="text-[10.5px] uppercase tracking-[0.14em] text-faint">Fields</div>
      {fields.map((f, i) => {
        const hasOptions = f.type === "select" || f.type === "multiselect";
        return (
          <div key={i} className="flex flex-wrap items-center gap-1.5">
            <input className={`${inputCls} w-32`} placeholder="label" value={f.label} onChange={(e) => update(i, { label: e.target.value, key: f.key || e.target.value })} />
            <input className={`${inputCls} w-28`} placeholder="key" value={f.key} onChange={(e) => update(i, { key: e.target.value })} />
            <select className={`${inputCls} w-32`} value={f.type} onChange={(e) => update(i, { type: e.target.value as FieldDef["type"] })}>
              {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {hasOptions && (
              <input
                className={`${inputCls} flex-1`}
                placeholder="options, comma-separated"
                value={(f.options ?? []).join(", ")}
                onChange={(e) => update(i, { options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
              />
            )}
            <button type="button" onClick={() => remove(i)} className="text-faint hover:text-rose-300"><Trash2 size={13} /></button>
          </div>
        );
      })}
      <button type="button" onClick={add} className="inline-flex items-center gap-1 text-[12px] text-dim hover:text-ink">
        <Plus size={12} /> Add field
      </button>
    </div>
  );
}

function RelationForm({ typeIds, onSave }: { typeIds: string[]; onSave: (i: { id: string; label: string; from: string[]; to: string[] }) => void }) {
  const [label, setLabel] = useState("");
  const [id, setId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  return (
    <div className="mt-3 space-y-2 rounded-lg border border-line p-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">New relation</div>
      <div className="grid grid-cols-2 gap-2">
        <input className={inputCls} placeholder="Label (e.g. member of)" value={label} onChange={(e) => setLabel(e.target.value)} />
        <input className={inputCls} placeholder="id (e.g. MEMBER_OF)" value={id} onChange={(e) => setId(e.target.value)} />
        <input className={inputCls} placeholder={`from ids (${typeIds.slice(0, 2).join(",") || "*"})`} value={from} onChange={(e) => setFrom(e.target.value)} />
        <input className={inputCls} placeholder="to ids (e.g. startup or *)" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      <button
        type="button"
        disabled={!label.trim()}
        onClick={() => {
          onSave({
            id: id || label,
            label,
            from: from.split(",").map((s) => s.trim()).filter(Boolean),
            to: to.split(",").map((s) => s.trim()).filter(Boolean),
          });
          setLabel(""); setId(""); setFrom(""); setTo("");
        }}
        className={btnCls}
      >
        <Plus size={14} /> Add relation
      </button>
    </div>
  );
}
