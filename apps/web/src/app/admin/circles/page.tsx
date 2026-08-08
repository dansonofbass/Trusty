"use client";

import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, CircleDot, Loader2, Search, Tags, Trash2, Users, X } from "lucide-react";
import { TOPIC_TAXONOMY } from "@constellation/graph-core";
import { deleteEntityAdmin } from "@/lib/adminEntitiesClient";

interface CircleMentor {
  nodeId: string;
  label: string;
}

interface AdminCircle {
  id: string;
  label: string;
  description: string;
  category: string;
  topicTags: string[];
  mentors: CircleMentor[];
  open: boolean;
  app: string;
  memberCount: number;
}

interface SpecialistHit {
  nodeId: string;
  label: string;
  nodeType: string;
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
  const [mentorsId, setMentorsId] = useState<string | null>(null);
  const [mq, setMq] = useState("");
  const [hits, setHits] = useState<SpecialistHit[]>([]);
  const [mentorBusy, setMentorBusy] = useState(false);

  // Specialist search for the mentor picker (reuses the admin search that
  // backs the specialist topic-tag editor).
  useEffect(() => {
    if (!mentorsId) return;
    const t = setTimeout(async () => {
      if (mq.trim().length < 2) return setHits([]);
      try {
        const r = await fetch(`/api/admin/specialists/search?q=${encodeURIComponent(mq.trim())}`, { cache: "no-store" });
        setHits(((await r.json()) as { nodes: SpecialistHit[] }).nodes ?? []);
      } catch {
        setHits([]);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [mq, mentorsId]);

  const pinMentor = async (circleId: string, specialistId: string) => {
    setMentorBusy(true);
    try {
      const r = await fetch(`/api/admin/circles/${encodeURIComponent(circleId)}/mentors`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ specialistId }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `failed (${r.status})`);
      setMq("");
      setHits([]);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setMentorBusy(false);
    }
  };

  const unpinMentor = async (circleId: string, specialistId: string) => {
    setMentorBusy(true);
    try {
      await fetch(
        `/api/admin/circles/${encodeURIComponent(circleId)}/mentors/${encodeURIComponent(specialistId)}`,
        { method: "DELETE" },
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setMentorBusy(false);
    }
  };

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
                    {c.mentors.length > 0 && (
                      <span className="flex items-center gap-1"><BadgeCheck size={11} /> {c.mentors.length} pinned</span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    onClick={() => setMentorsId(mentorsId === c.id ? null : c.id)}
                    className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[12.5px] font-semibold text-dim hover:text-ink"
                  >
                    <BadgeCheck size={13} /> Mentors
                  </button>
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

              {mentorsId === c.id && (
                <div className="mt-3 rounded-lg border border-line p-3">
                  <p className="mb-2 text-[11.5px] text-faint">
                    Pinned mentors show at the top of this circle&rsquo;s chat, ahead of automatic topic-tag matches.
                  </p>
                  {c.mentors.length > 0 && (
                    <ul className="mb-2 space-y-1">
                      {c.mentors.map((m) => (
                        <li key={m.nodeId} className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5">
                          <BadgeCheck size={12} style={{ color: "var(--color-accent)" }} />
                          <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{m.label}</span>
                          <button
                            disabled={mentorBusy}
                            onClick={() => void unpinMentor(c.id, m.nodeId)}
                            aria-label={`Unpin ${m.label}`}
                            className="text-faint hover:text-rose-300 disabled:opacity-50"
                          >
                            <X size={13} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="relative">
                    <Search size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
                    <input
                      value={mq}
                      onChange={(e) => setMq(e.target.value)}
                      placeholder="Search specialists to pin…"
                      className="w-full rounded-lg border border-line bg-transparent py-1.5 pl-7 pr-2.5 text-[12.5px] text-ink outline-none placeholder:text-faint"
                    />
                  </div>
                  {hits.length > 0 && (
                    <ul className="mt-1.5 divide-y divide-line overflow-hidden rounded-lg border border-line">
                      {hits.map((h) => (
                        <li key={h.nodeId}>
                          <button
                            disabled={mentorBusy}
                            onClick={() => void pinMentor(c.id, h.nodeId)}
                            className="flex w-full items-center justify-between px-2.5 py-1.5 text-left text-[12.5px] text-ink hover:bg-[var(--color-tint)] disabled:opacity-50"
                          >
                            <span className="truncate">{h.label}</span>
                            <span className="shrink-0 text-[10.5px] capitalize text-faint">{h.nodeType.replace(/_/g, " ")}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

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
