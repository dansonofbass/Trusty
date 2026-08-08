"use client";

import { useCallback, useEffect, useState } from "react";
import { CircleDot, Loader2, Tags, Trash2, Users } from "lucide-react";
import { TOPIC_TAXONOMY } from "@constellation/graph-core";
import { deleteEntityAdmin } from "@/lib/adminEntitiesClient";

interface AdminCircle {
  id: string;
  label: string;
  description: string;
  category: string;
  topicTags: string[];
  open: boolean;
  app: string;
  memberCount: number;
}

const APPS = ["irham", "summit", "general"];

export default function AdminCirclesPage() {
  const [app, setApp] = useState("irham");
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [circles, setCircles] = useState<AdminCircle[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const r = await fetch(`/api/admin/circles?app=${encodeURIComponent(app)}`, { cache: "no-store" });
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `fetch failed (${r.status})`);
      const data = (await r.json()) as { circles: AdminCircle[] };
      setCircles(data.circles);
      setStatus("ok");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }, [app]);
  useEffect(() => { void load(); }, [load]);

  const startEdit = (c: AdminCircle) => {
    setEditingId(c.id);
    setTags(c.topicTags);
  };

  const toggle = (t: string) => setTags((xs) => (xs.includes(t) ? xs.filter((x) => x !== t) : [...xs, t]));

  const save = async (id: string) => {
    setSaving(true);
    try {
      const r = await fetch(`/api/admin/circles/${encodeURIComponent(id)}/topic-tags`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tags }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `save failed (${r.status})`);
      setCircles((cs) => cs.map((c) => (c.id === id ? { ...c, topicTags: tags } : c)));
      setEditingId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (c: AdminCircle) => {
    if (!confirm(`Delete circle "${c.label}"? This removes it and every member's membership — can't be undone.`)) return;
    setDeletingId(c.id);
    try {
      await deleteEntityAdmin(c.id);
      setCircles((cs) => cs.filter((x) => x.id !== c.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <header className="mb-6">
        <div className="flex items-center gap-2">
          <CircleDot size={18} className="text-faint" />
          <h1 className="text-2xl font-extrabold tracking-tight text-ink" style={{ fontFamily: "var(--font-display)" }}>
            Circles
          </h1>
        </div>
        <p className="mt-1 text-sm text-dim">
          Every circle in a space, across every member — not just yours. Tag topics so the right circle surfaces
          trusted-mentor cards (matched against admin-tagged specialists), or delete stale ones (e.g. old
          English-named circles after a rename).
        </p>
      </header>

      <div className="mb-5 flex gap-1 rounded-full border border-line bg-surface p-1 text-[12.5px]">
        {APPS.map((a) => (
          <button
            key={a}
            onClick={() => setApp(a)}
            className={`flex-1 rounded-full py-1.5 font-semibold capitalize transition ${
              app === a ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]" : "text-faint hover:text-ink"
            }`}
          >
            {a}
          </button>
        ))}
      </div>

      {status === "loading" && (
        <div className="flex items-center gap-2 text-dim"><Loader2 className="animate-spin" size={16} /> Loading…</div>
      )}
      {status === "error" && <div className="rounded-2xl border border-line bg-surface p-6 text-sm text-rose-300">{error}</div>}

      {status === "ok" && circles.length === 0 && (
        <div className="rounded-2xl border border-line bg-surface p-10 text-center backdrop-blur-md">
          <CircleDot className="mx-auto mb-3 text-faint" size={28} />
          <p className="text-[14px] text-ink">No circles in this space yet.</p>
        </div>
      )}

      {status === "ok" && circles.length > 0 && (
        <ul className="space-y-3">
          {circles.map((c) => (
            <li key={c.id} className="rounded-2xl border border-line bg-surface p-4 backdrop-blur-md">
              <div className="flex flex-wrap items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div dir="auto" className="text-[13.5px] font-semibold text-ink">{c.label}</div>
                  {c.description && <div dir="auto" className="mt-0.5 text-[12px] text-faint">{c.description}</div>}
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-faint">
                    <span className="flex items-center gap-1"><Users size={11} /> {c.memberCount}</span>
                    <span className="rounded-full border border-line px-1.5 py-0.5 capitalize">{c.category}</span>
                    {!c.open && <span className="rounded-full border border-line px-1.5 py-0.5">invite-only</span>}
                    {c.topicTags.map((t) => (
                      <span key={t} className="rounded-full bg-[var(--color-accent-soft)] px-1.5 py-0.5 capitalize text-[var(--color-accent)]">
                        {t.replace(/_/g, " ")}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    onClick={() => (editingId === c.id ? setEditingId(null) : startEdit(c))}
                    className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[12.5px] font-semibold text-dim hover:text-ink"
                  >
                    <Tags size={13} /> Tags
                  </button>
                  <button
                    disabled={deletingId === c.id}
                    onClick={() => void remove(c)}
                    className="flex items-center gap-1.5 rounded-lg border border-rose-400/40 px-3 py-1.5 text-[12.5px] font-semibold text-rose-300 disabled:opacity-50"
                  >
                    {deletingId === c.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                  </button>
                </div>
              </div>

              {editingId === c.id && (
                <div className="mt-3 rounded-lg border border-line p-3">
                  <div className="flex flex-wrap gap-1.5">
                    {TOPIC_TAXONOMY.map((t) => {
                      const on = tags.includes(t);
                      return (
                        <button
                          key={t}
                          onClick={() => toggle(t)}
                          className={`rounded-full border px-2.5 py-1 text-[11.5px] font-medium capitalize transition ${
                            on
                              ? "border-transparent bg-[var(--color-accent)] text-space"
                              : "border-line text-dim hover:border-[var(--color-accent)]/60"
                          }`}
                        >
                          {t.replace(/_/g, " ")}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    disabled={saving}
                    onClick={() => void save(c.id)}
                    className="mt-3 rounded-lg px-3 py-1.5 text-[12.5px] font-bold text-space disabled:opacity-50"
                    style={{ background: "var(--color-accent)" }}
                  >
                    {saving ? "Saving…" : "Save tags"}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
