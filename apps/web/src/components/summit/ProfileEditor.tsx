"use client";

import { useMemo, useState } from "react";
import { entityTypesForApp, activeRolesOf, type FieldDef, type GNode } from "@constellation/graph-core";
import { saveMyProfile, SUMMIT_APP } from "@/lib/summitClient";
import { Star } from "lucide-react";

/**
 * Rich, easy profile editor — ONE PERSON, MANY ROLES: toggle any number of
 * roles on; the first is the PRIMARY (what the graph shows — tap ★ to change).
 * The form is the UNION of the active roles' (admin-defined) schemas, deduped:
 * shared fields ("About you") render once, role-specific fields render in
 * their own titled sections. Writes via upsertProfile (union-validated).
 */
export default function ProfileEditor({
  myNode,
  onSaved,
  onCancel,
}: {
  myNode: GNode | null;
  onSaved: (node: GNode) => void;
  onCancel?: () => void;
}) {
  const roleDefs = useMemo(
    () => entityTypesForApp(SUMMIT_APP).filter((t) => t.baseType === "person"),
    [],
  );
  const [roles, setRoles] = useState<string[]>(() =>
    myNode ? activeRolesOf(myNode).filter((r) => roleDefs.some((d) => d.id === r)) : [],
  );
  const [label, setLabel] = useState<string>(myNode?.label ?? "");
  const [values, setValues] = useState<Record<string, unknown>>({ ...(myNode?.properties ?? {}) });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const toggleRole = (id: string) =>
    setRoles((rs) => (rs.includes(id) ? rs.filter((r) => r !== id) : [...rs, id]));
  const makePrimary = (id: string) =>
    setRoles((rs) => (rs.includes(id) ? [id, ...rs.filter((r) => r !== id)] : rs));

  const setVal = (k: string, v: unknown) => setValues((p) => ({ ...p, [k]: v }));
  const toggleMulti = (k: string, opt: string) =>
    setValues((p) => {
      const cur = Array.isArray(p[k]) ? (p[k] as string[]) : [];
      return { ...p, [k]: cur.includes(opt) ? cur.filter((x) => x !== opt) : [...cur, opt] };
    });

  // Union of the active roles' fields: shared first (in ≥2 roles), then
  // one section per role for what's uniquely its own.
  const sections = useMemo(() => {
    const active = roles.map((r) => roleDefs.find((d) => d.id === r)).filter((x): x is NonNullable<typeof x> => !!x);
    const count = new Map<string, number>();
    for (const d of active) for (const f of d.fields) count.set(f.key, (count.get(f.key) ?? 0) + 1);
    const seen = new Set<string>();
    const shared: FieldDef[] = [];
    for (const d of active) {
      for (const f of d.fields) {
        if ((count.get(f.key) ?? 0) >= 2 && !seen.has(f.key)) {
          seen.add(f.key);
          shared.push(f);
        }
      }
    }
    const perRole = active
      .map((d) => ({ id: d.id, label: d.label, fields: d.fields.filter((f) => !seen.has(f.key) && (count.get(f.key) ?? 0) === 1) }))
      .filter((s) => s.fields.length > 0);
    return { shared, perRole };
  }, [roles, roleDefs]);

  async function save() {
    if (roles.length === 0 || !label.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      const node = await saveMyProfile({ roles, label: label.trim(), properties: values });
      onSaved(node);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const primary = roles[0];

  return (
    <div className="space-y-4">
      {/* Role toggles — any number active; ★ marks the primary shown on the graph */}
      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-faint">Your roles — pick all that apply</div>
        <p className="mb-2 text-[11px] text-faint">★ = primary (how the graph shows you). Tap an active role to make it primary.</p>
        <div className="flex flex-wrap gap-2">
          {roleDefs.map((r) => {
            const active = roles.includes(r.id);
            const isPrimary = primary === r.id;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => (active ? (isPrimary ? toggleRole(r.id) : makePrimary(r.id)) : toggleRole(r.id))}
                className="inline-flex items-center gap-1 rounded-full border px-3.5 py-1.5 text-sm"
                style={active
                  ? { borderColor: "rgba(255,140,90,0.6)", background: isPrimary ? "rgba(255,140,90,0.2)" : "rgba(255,140,90,0.1)", color: "var(--color-ink)" }
                  : { borderColor: "var(--color-line)", color: "var(--color-dim)" }}
              >
                {isPrimary && <Star size={12} fill="#ff8c5a" color="#ff8c5a" />}
                {r.label}
              </button>
            );
          })}
        </div>
        {roles.length > 1 && (
          <p className="mt-1.5 text-[11px] text-dim">
            You’re active as {roles.map((r) => roleDefs.find((d) => d.id === r)?.label).join(" + ")} — one profile, all findable.
          </p>
        )}
      </div>

      {roles.length > 0 && (
        <>
          <Labelled label="Your name">
            <input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Full name" className={inputCls} />
          </Labelled>

          {sections.shared.length > 0 && (
            <section className="space-y-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-faint">About you</div>
              {sections.shared.map((f) => (
                <Field key={f.key} f={f} value={values[f.key]} setVal={setVal} toggleMulti={toggleMulti} />
              ))}
            </section>
          )}

          {sections.perRole.map((s) => (
            <section key={s.id} className="space-y-3 rounded-xl border border-line/60 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color: "#ff8c5a" }}>
                As a {s.label}
              </div>
              {s.fields.map((f) => (
                <Field key={f.key} f={f} value={values[f.key]} setVal={setVal} toggleMulti={toggleMulti} />
              ))}
            </section>
          ))}

          {err && <p className="text-sm text-rose-300">{err}</p>}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              disabled={!label.trim() || saving}
              onClick={save}
              className="flex-1 rounded-xl px-4 py-3 text-sm font-semibold disabled:opacity-50"
              style={{ background: "#9af0c8", color: "#04121a" }}
            >
              {saving ? "Saving…" : "Save profile"}
            </button>
            {onCancel && (
              <button type="button" onClick={onCancel} className="rounded-xl border border-line px-4 py-3 text-sm text-dim">
                Cancel
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

const inputCls = "w-full rounded-lg border border-line bg-space/60 px-3 py-2.5 text-sm text-ink outline-none focus:border-gold/60";

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
        <select value={(value as string) ?? ""} onChange={(e) => setVal(f.key, e.target.value)} className={inputCls}>
          <option value="">—</option>
          {f.options?.map((o) => <option key={o} value={o}>{o.replace(/_/g, " ")}</option>)}
        </select>
      </Labelled>
    );
  }
  if (f.type === "multiselect") {
    const cur = Array.isArray(value) ? (value as string[]) : [];
    return (
      <Labelled label={f.label}>
        <div className="flex flex-wrap gap-1.5">
          {f.options?.map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => toggleMulti(f.key, o)}
              className="rounded-full border px-2.5 py-1 text-[12px]"
              style={cur.includes(o)
                ? { borderColor: "rgba(154,240,200,0.6)", background: "rgba(154,240,200,0.12)", color: "var(--color-ink)" }
                : { borderColor: "var(--color-line)", color: "var(--color-faint)" }}
            >
              {o.replace(/_/g, " ")}
            </button>
          ))}
        </div>
      </Labelled>
    );
  }
  return (
    <Labelled label={f.label}>
      <input
        type={f.type === "number" || f.type === "money" ? "number" : "text"}
        value={(value as string | number | undefined) ?? ""}
        onChange={(e) => setVal(f.key, e.target.value)}
        placeholder={f.placeholder}
        className={inputCls}
      />
    </Labelled>
  );
}
