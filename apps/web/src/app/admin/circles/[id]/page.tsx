"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  BadgeCheck, ChevronLeft, CircleDot, ExternalLink, Loader2, MessageSquare, Save, ShieldCheck, Tags, Users,
} from "lucide-react";
import { TOPIC_TAXONOMY } from "@constellation/graph-core";

/**
 * One circle, everything about it — settings, forum sections, tags in use,
 * moderators, pinned mentors and recent activity. The list page stays a list;
 * managing a circle deserves a page, not a dropdown.
 */

interface Detail {
  id: string;
  label: string;
  description: string;
  category: string;
  open: boolean;
  app: string;
  topicTags: string[];
  memberCount: number;
  topics: { id: string; label: string; description: string; postCount: number }[];
  tags: { tag: string; count: number }[];
  roles: { userId: string; role: string; label: string }[];
  mentors: { nodeId: string; label: string }[];
  postCount: number;
  answerCount: number;
  recentPosts: { id: string; title: string; answerCount: number; score: number; tags: string[]; createdAt: string }[];
}

const card = "rounded-2xl border border-line bg-surface p-4 backdrop-blur-md";
const input = "w-full rounded-lg border border-line bg-transparent px-3 py-2 text-[13px] text-ink outline-none focus:border-[var(--color-accent)]";

export default function AdminCircleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("topic");
  const [open, setOpen] = useState(true);
  const [tags, setTags] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/admin/circles/${encodeURIComponent(id)}/detail`, { cache: "no-store" });
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `failed (${r.status})`);
      const data = (await r.json()) as Detail;
      setD(data);
      setLabel(data.label);
      setDescription(data.description);
      setCategory(data.category);
      setOpen(data.open);
      setTags(data.topicTags);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      // Settings and expertise tags are separate endpoints — one is graph node
      // data, the other drives specialist matching.
      const a = await fetch(`/api/admin/circles/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label, description, category, open }),
      });
      if (!a.ok) throw new Error((await a.json().catch(() => null))?.error ?? "save failed");
      const b = await fetch(`/api/admin/circles/${encodeURIComponent(id)}/topic-tags`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tags }),
      });
      if (!b.ok) throw new Error((await b.json().catch(() => null))?.error ?? "tags failed");
      setSavedAt(new Date().toLocaleTimeString());
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (error && !d) return <div className="mx-auto max-w-3xl px-6 py-8 text-sm text-rose-300">{error}</div>;
  if (!d) {
    return (
      <div className="mx-auto flex max-w-3xl items-center gap-2 px-6 py-8 text-dim">
        <Loader2 className="animate-spin" size={16} /> Loading…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <Link href="/admin/circles" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-faint hover:text-ink">
        <ChevronLeft size={15} /> All circles
      </Link>

      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 dir="auto" className="flex items-center gap-2 text-2xl font-extrabold text-ink" style={{ fontFamily: "var(--font-display)" }}>
            <CircleDot size={20} className="shrink-0 text-faint" /> {d.label}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-[12px] text-faint">
            <span className="flex items-center gap-1"><Users size={12} /> {d.memberCount} members</span>
            <span className="flex items-center gap-1"><MessageSquare size={12} /> {d.postCount} questions · {d.answerCount} answers</span>
            <span className="rounded-full border border-line px-1.5 py-0.5">{d.app}</span>
          </div>
        </div>
        <a
          href={`/c/${encodeURIComponent(d.id)}`}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[12.5px] text-dim hover:text-ink"
        >
          <ExternalLink size={13} /> Open forum
        </a>
      </header>

      {error && <p className="mb-3 text-[12.5px] text-rose-300">{error}</p>}

      <section className={`${card} mb-4`}>
        <h2 className="mb-3 text-[13px] font-bold text-ink">Settings</h2>
        <div className="space-y-3">
          <div>
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-faint">Name</span>
            <input dir="auto" value={label} onChange={(e) => setLabel(e.target.value)} className={input} />
          </div>
          <div>
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-faint">Description</span>
            <textarea dir="auto" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} className={`${input} resize-none`} />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-lg border border-line bg-transparent px-2 py-1.5 text-[12.5px] text-ink outline-none">
              {["topic", "community", "event", "team"].map((c) => (
                <option key={c} value={c} className="bg-[#111827]">{c}</option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-[12.5px] text-dim">
              <input type="checkbox" checked={open} onChange={(e) => setOpen(e.target.checked)} />
              Open — anyone in this space can join
            </label>
          </div>
          <div>
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-faint">
              Expertise tags — which specialists surface here
            </span>
            <div className="flex flex-wrap gap-1.5">
              {TOPIC_TAXONOMY.map((t) => {
                const on = tags.includes(t);
                return (
                  <button
                    key={t}
                    onClick={() => setTags((xs) => (on ? xs.filter((x) => x !== t) : [...xs, t]))}
                    className={`rounded-full border px-2.5 py-1 text-[11.5px] capitalize transition ${
                      on ? "border-transparent bg-[var(--color-accent)] text-space" : "border-line text-dim hover:border-[var(--color-accent)]/60"
                    }`}
                  >
                    {t.replace(/_/g, " ")}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => void save()}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-bold text-space disabled:opacity-50"
              style={{ background: "var(--color-accent)" }}
            >
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save
            </button>
            {savedAt && <span className="text-[11.5px] text-faint">Saved {savedAt}</span>}
          </div>
        </div>
      </section>

      <div className="mb-4 grid gap-4 sm:grid-cols-2">
        <section className={card}>
          <h2 className="mb-2 flex items-center gap-1.5 text-[13px] font-bold text-ink"><ShieldCheck size={14} className="text-faint" /> Moderators</h2>
          {d.roles.length === 0 ? (
            <p className="text-[12px] text-faint">None yet — appoint from the circles list.</p>
          ) : (
            <ul className="space-y-1">
              {d.roles.map((r) => (
                <li key={r.userId} className="flex items-center gap-2 text-[12.5px] text-ink">
                  <ShieldCheck size={12} style={{ color: "var(--color-accent)" }} />
                  <span className="min-w-0 flex-1 truncate">{r.label}</span>
                  <span className="text-[10.5px] capitalize text-faint">{r.role}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={card}>
          <h2 className="mb-2 flex items-center gap-1.5 text-[13px] font-bold text-ink"><BadgeCheck size={14} className="text-faint" /> Pinned mentors</h2>
          {d.mentors.length === 0 ? (
            <p className="text-[12px] text-faint">None pinned.</p>
          ) : (
            <ul className="space-y-1">
              {d.mentors.map((m) => (
                <li key={m.nodeId}>
                  <a href={`/s/${encodeURIComponent(m.nodeId)}`} target="_blank" rel="noreferrer" className="text-[12.5px] text-ink hover:underline">
                    {m.label}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="mb-4 grid gap-4 sm:grid-cols-2">
        <section className={card}>
          <h2 className="mb-2 text-[13px] font-bold text-ink">Sections ({d.topics.length})</h2>
          {d.topics.length === 0 ? (
            <p className="text-[12px] text-faint">No sections — create them in the forum.</p>
          ) : (
            <ul className="space-y-1">
              {d.topics.map((t) => (
                <li key={t.id} className="flex items-center gap-2 text-[12.5px]">
                  <span dir="auto" className="min-w-0 flex-1 truncate text-ink">{t.label}</span>
                  <span className="text-[11px] text-faint">{t.postCount}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={card}>
          <h2 className="mb-2 flex items-center gap-1.5 text-[13px] font-bold text-ink"><Tags size={14} className="text-faint" /> Tags in use</h2>
          {d.tags.length === 0 ? (
            <p className="text-[12px] text-faint">No question tags yet.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {d.tags.map((t) => (
                <span key={t.tag} className="rounded-full bg-[var(--color-tint)] px-2 py-0.5 text-[11.5px] capitalize text-dim">
                  {t.tag.replace(/_/g, " ")} <span className="text-faint">{t.count}</span>
                </span>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className={card}>
        <h2 className="mb-2 text-[13px] font-bold text-ink">Recent questions</h2>
        {d.recentPosts.length === 0 ? (
          <p className="text-[12px] text-faint">Nothing posted yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {d.recentPosts.map((p) => (
              <li key={p.id} className="py-2">
                <a
                  href={`/c/${encodeURIComponent(d.id)}/p/${encodeURIComponent(p.id)}`}
                  target="_blank"
                  rel="noreferrer"
                  dir="auto"
                  className="block truncate text-[12.5px] text-ink hover:underline"
                >
                  {p.title}
                </a>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-faint">
                  <span>{p.answerCount} answers · {p.score} votes</span>
                  {p.tags.map((t) => (
                    <span key={t} className="rounded-full bg-[var(--color-tint)] px-1.5 py-0.5 capitalize">{t.replace(/_/g, " ")}</span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
