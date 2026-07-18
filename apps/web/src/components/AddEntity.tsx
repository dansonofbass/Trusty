"use client";

import { useMemo, useState } from "react";
import {
  entityTypeById,
  entityTypesByDomain,
  type EntityTypeDef,
  type FieldDef,
} from "@constellation/graph-core";
import { useUI } from "@/lib/store";
import { createEntity } from "@/lib/ontologyClient";
import { Plus } from "lucide-react";
import PanelShell from "./dock/PanelShell";

/**
 * Add an ontology entity (provider / place / property) with all its typed
 * properties — the form is generated from the entity type's schema, so a home
 * gets bedrooms/price/area and a restaurant gets cuisine/price range, etc.
 */
export default function AddEntity({
  variant = "standalone",
}: {
  /** "docked": no FAB, driven by the ActionDock (desktop). "standalone": own
   *  FAB + local state (MobileGraph — unchanged). */
  variant?: "standalone" | "docked";
}) {
  const docked = variant === "docked";
  const [localOpen, setLocalOpen] = useState(false);
  const rightPanel = useUI((s) => s.rightPanel);
  const setRightPanel = useUI((s) => s.setRightPanel);
  const open = docked ? rightPanel === "addEntity" : localOpen;
  const setOpen = (v: boolean) => (docked ? setRightPanel(v ? "addEntity" : null) : setLocalOpen(v));
  const [typeId, setTypeId] = useState("");
  const [label, setLabel] = useState("");
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const select = useUI((s) => s.select);
  const setFocus = useUI((s) => s.setFocus);
  const bumpGraph = useUI((s) => s.bumpGraph);

  const groups = useMemo(() => entityTypesByDomain(), []);
  const def: EntityTypeDef | undefined = typeId ? entityTypeById(typeId) : undefined;

  const reset = () => {
    setTypeId("");
    setLabel("");
    setValues({});
    setErr(null);
  };
  const close = () => {
    setOpen(false);
    reset();
  };

  const setVal = (k: string, v: unknown) => setValues((prev) => ({ ...prev, [k]: v }));
  const toggleMulti = (k: string, opt: string) =>
    setValues((prev) => {
      const cur = Array.isArray(prev[k]) ? (prev[k] as string[]) : [];
      return { ...prev, [k]: cur.includes(opt) ? cur.filter((x) => x !== opt) : [...cur, opt] };
    });

  async function create() {
    if (!def || !label.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      const { nodeId } = await createEntity({ entityType: def.id, label: label.trim(), properties: values });
      bumpGraph(); // reload the graph so the new node appears
      if (nodeId) {
        select(nodeId);
        setFocus(nodeId);
      }
      close();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const body = (
    <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
            {!def ? (
              // Step 1 — pick the entity type (grouped by domain).
              <div className="space-y-4">
                {groups.map((g) => (
                  <section key={g.domain}>
                    <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-faint">{g.label}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {g.types.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setTypeId(t.id)}
                          className="rounded-full border border-line px-2.5 py-1 text-[12px] text-dim hover:border-gold/60 hover:text-ink"
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            ) : (
              // Step 2 — name + schema-driven property fields.
              <div className="space-y-3">
                <button type="button" onClick={reset} className="text-[11px] text-dim hover:text-ink">← change type</button>

                <Labelled label="Name">
                  <input
                    autoFocus
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder={`${def.label} name`}
                    className="w-full rounded-lg border border-line bg-space/60 px-3 py-2 text-sm text-ink outline-none focus:border-gold/60"
                  />
                </Labelled>

                {def.fields.map((f) => (
                  <Field key={f.key} f={f} value={values[f.key]} setVal={setVal} toggleMulti={toggleMulti} />
                ))}

                {err && <p className="text-sm text-rose-300">{err}</p>}
              </div>
            )}
    </div>
  );

  const footer = def ? (
    <div>
      <button
        type="button"
        disabled={!label.trim() || saving}
        onClick={() => void create()}
        className="btn-accent w-full"
      >
        {saving ? "Adding…" : `Add ${def.label}`}
      </button>
      <p className="mt-2 text-center text-[11px] text-faint">
        Then recommend it (Inspector → Recommend) so it shows in trust search.
      </p>
    </div>
  ) : undefined;

  if (docked) {
    if (!open) return null;
    return (
      <PanelShell
        title={def ? `New ${def.label}` : "Add a provider or place"}
        icon={<Plus size={15} />}
        onClose={close}
        footer={footer}
      >
        {body}
      </PanelShell>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        className="fixed bottom-[76px] right-6 z-40 rounded-full border border-line bg-surface px-4 py-2 text-sm font-semibold text-ink backdrop-blur-md shadow-lg hover:border-[var(--color-accent-line)]"
        style={{ fontFamily: "var(--font-display)", borderColor: open ? "rgba(154,240,200,0.6)" : undefined }}
      >
        ＋ Add entity
      </button>

      {open && (
        <aside className="pointer-events-auto fixed bottom-4 right-4 top-20 z-40 flex w-[380px] max-w-[calc(100vw-2rem)] flex-col rounded-2xl border border-line bg-nebula/95 shadow-2xl backdrop-blur-md">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-[15px] font-extrabold text-ink" style={{ fontFamily: "var(--font-display)" }}>
              {def ? `New ${def.label}` : "Add a provider or place"}
            </h2>
            <button type="button" onClick={close} className="text-dim hover:text-ink">✕</button>
          </div>
          {body}
          {footer && <div className="border-t border-line px-4 py-3">{footer}</div>}
        </aside>
      )}
    </>
  );
}

function Labelled({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-dim">{label}</span>
      {children}
    </label>
  );
}

function Field({
  f,
  value,
  setVal,
  toggleMulti,
}: {
  f: FieldDef;
  value: unknown;
  setVal: (k: string, v: unknown) => void;
  toggleMulti: (k: string, opt: string) => void;
}) {
  const unit = f.unit ? <span className="ml-1 text-[10px] text-faint">{f.unit}</span> : null;

  if (f.type === "boolean") {
    return (
      <label className="flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" checked={!!value} onChange={(e) => setVal(f.key, e.target.checked)} />
        {f.label}
      </label>
    );
  }

  if (f.type === "select") {
    return (
      <Labelled label={f.label}>
        <select
          value={(value as string) ?? ""}
          onChange={(e) => setVal(f.key, e.target.value)}
          className="w-full rounded-lg border border-line bg-space/60 px-2 py-2 text-sm text-ink outline-none focus:border-gold/60"
        >
          <option value="">—</option>
          {f.options?.map((o) => (
            <option key={o} value={o}>{o.replace(/_/g, " ")}</option>
          ))}
        </select>
      </Labelled>
    );
  }

  if (f.type === "multiselect") {
    const cur = Array.isArray(value) ? (value as string[]) : [];
    return (
      <Labelled label={f.label}>
        <div className="flex flex-wrap gap-1">
          {f.options?.map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => toggleMulti(f.key, o)}
              className="rounded-full border px-2 py-0.5 text-[11px]"
              style={{
                borderColor: cur.includes(o) ? "rgba(154,240,200,0.6)" : "var(--color-line)",
                color: cur.includes(o) ? "var(--color-ink)" : "var(--color-faint)",
              }}
            >
              {o.replace(/_/g, " ")}
            </button>
          ))}
        </div>
      </Labelled>
    );
  }

  // text | geo | number | money
  return (
    <Labelled label={<>{f.label}{unit}</>}>
      <input
        type={f.type === "number" || f.type === "money" ? "number" : "text"}
        value={(value as string | number | undefined) ?? ""}
        onChange={(e) => setVal(f.key, e.target.value)}
        placeholder={f.placeholder}
        className="w-full rounded-lg border border-line bg-space/60 px-3 py-2 text-sm text-ink outline-none focus:border-gold/60"
      />
    </Labelled>
  );
}
