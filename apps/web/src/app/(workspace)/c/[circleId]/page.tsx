"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, MessageSquarePlus, Plus } from "lucide-react";
import PostCard from "@/components/forum/PostCard";
import CircleSidebar from "@/components/forum/CircleSidebar";
import {
  createPost,
  createTopic,
  fetchCircleAbout,
  fetchPosts,
  fetchTopics,
  type Author,
  type CircleAbout,
  type Post,
  type PostSort,
  type Topic,
} from "@/lib/forumClient";
import { joinCircle } from "@/lib/socialClient";
import { useT } from "@/lib/i18n";

/**
 * Circle forum home — the platform's centre of gravity.
 *
 * Layout is Reddit-shaped on purpose: curated topics + a question feed in the
 * centre, and a sidebar answering "who runs this and who should I ask". All
 * copy goes through t() because irham is Persian-first and RTL; direction is
 * applied on <html> by the i18n provider, so this file uses logical classes
 * (text-start, ms-*) and never branches on locale for layout.
 */

const SORTS: PostSort[] = ["hot", "new", "top"];

export default function CircleForumPage({ params }: { params: Promise<{ circleId: string }> }) {
  const { circleId } = use(params);
  const t = useT();

  const [about, setAbout] = useState<CircleAbout | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [authors, setAuthors] = useState<Record<string, Author>>({});
  const [topicId, setTopicId] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([]);
  const [suggestedTags, setSuggestedTags] = useState<string[]>([]);
  const [sort, setSort] = useState<PostSort>("hot");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [newTopic, setNewTopic] = useState(false);

  const loadPosts = useCallback(async () => {
    const r = await fetchPosts(circleId, { topicId: topicId ?? undefined, tag: tag ?? undefined, sort });
    setPosts(r.posts);
    setAuthors(r.authors);
    setTags(r.tags ?? []);
    setSuggestedTags(r.suggestedTags ?? []);
  }, [circleId, topicId, tag, sort]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([fetchCircleAbout(circleId), fetchTopics(circleId)])
      .then(([a, tp]) => {
        if (!alive) return;
        setAbout(a);
        setTopics(tp.topics);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [circleId]);

  useEffect(() => {
    void loadPosts().catch(() => undefined);
  }, [loadPosts]);

  const join = async () => {
    try {
      await joinCircle(circleId);
      setAbout((a) => (a ? { ...a, mine: true, memberCount: a.memberCount + 1 } : a));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (loading) {
    return (
      <div className="grid h-full place-items-center text-[var(--color-dim)]">
        <Loader2 className="animate-spin" size={20} />
      </div>
    );
  }
  if (error || !about) {
    return <div className="p-6 text-[13px] text-rose-300">{error ?? "not found"}</div>;
  }

  return (
    <div className="scroll-quiet h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[1040px] px-4 py-4">
        <header className="mb-4">
          <h1 dir="auto" className="text-[22px] font-extrabold text-ink" style={{ fontFamily: "var(--font-display)" }}>
            {about.label}
          </h1>
        </header>

        <div className="grid gap-4 md:grid-cols-[1fr_280px]">
          <div className="min-w-0">
            {/* topics — the curated skeleton */}
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              <button
                onClick={() => setTopicId(null)}
                className="rounded-full border px-3 py-1.5 text-[12px] font-semibold transition"
                style={
                  topicId === null
                    ? { borderColor: "var(--color-accent-line)", background: "var(--color-accent-soft)", color: "var(--color-accent)" }
                    : { borderColor: "var(--color-line)", color: "var(--color-dim)" }
                }
              >
                {t("forum.allPosts")}
              </button>
              {topics.map((tp) => (
                <button
                  key={tp.id}
                  onClick={() => setTopicId(tp.id)}
                  title={tp.description || undefined}
                  className="rounded-full border px-3 py-1.5 text-[12px] font-semibold transition"
                  style={
                    topicId === tp.id
                      ? { borderColor: "var(--color-accent-line)", background: "var(--color-accent-soft)", color: "var(--color-accent)" }
                      : { borderColor: "var(--color-line)", color: "var(--color-dim)" }
                  }
                >
                  <span dir="auto">{tp.label}</span>
                  <span className="ms-1.5 text-[10px] text-[var(--color-faint)]">{tp.postCount}</span>
                </button>
              ))}
              {about.canModerate && (
                <button
                  onClick={() => setNewTopic((v) => !v)}
                  className="rounded-full border border-dashed border-line px-3 py-1.5 text-[12px] text-[var(--color-faint)] hover:text-ink"
                >
                  <Plus size={11} className="inline" /> {t("forum.newTopic")}
                </button>
              )}
            </div>

            {newTopic && about.canModerate && (
              <TopicComposer
                circleId={circleId}
                onDone={(created) => {
                  setNewTopic(false);
                  if (created) void fetchTopics(circleId).then((r) => setTopics(r.topics));
                }}
              />
            )}

            {/* tag filter — classification carried over from the source
                answers, so migrated knowledge stays findable */}
            {tags.length > 0 && (
              <div className="mb-3 flex flex-wrap items-center gap-1.5">
                {tag && (
                  <button
                    onClick={() => setTag(null)}
                    className="rounded-full border border-line px-2.5 py-1 text-[11.5px] text-[var(--color-faint)] hover:text-ink"
                  >
                    ✕ {t("forum.clearTag")}
                  </button>
                )}
                {tags.map((x) => (
                  <button
                    key={x.tag}
                    onClick={() => setTag(tag === x.tag ? null : x.tag)}
                    className="rounded-full border px-2.5 py-1 text-[11.5px] font-medium capitalize transition"
                    style={
                      tag === x.tag
                        ? { borderColor: "var(--color-accent-line)", background: "var(--color-accent-soft)", color: "var(--color-accent)" }
                        : { borderColor: "var(--color-line)", color: "var(--color-dim)" }
                    }
                  >
                    {x.tag.replace(/_/g, " ")}
                    <span className="ms-1 text-[10px] text-[var(--color-faint)]">{x.count}</span>
                  </button>
                ))}
              </div>
            )}

            {/* sort + ask */}
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="flex gap-1 rounded-full border border-line p-1">
                {SORTS.map((s) => (
                  <button
                    key={s}
                    onClick={() => setSort(s)}
                    className="rounded-full px-2.5 py-1 text-[11.5px] font-semibold transition"
                    style={sort === s ? { background: "var(--color-accent-soft)", color: "var(--color-accent)" } : { color: "var(--color-faint)" }}
                  >
                    {t(s === "hot" ? "forum.sortHot" : s === "new" ? "forum.sortNew" : "forum.sortTop")}
                  </button>
                ))}
              </div>
              <div className="ms-auto">
                {about.mine ? (
                  <button
                    onClick={() => setAsking((v) => !v)}
                    className="flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-[12.5px] font-bold text-space"
                    style={{ background: "var(--color-accent)" }}
                  >
                    <MessageSquarePlus size={14} /> {t("forum.ask")}
                  </button>
                ) : (
                  <button
                    onClick={() => void join()}
                    className="rounded-xl px-3.5 py-2 text-[12.5px] font-bold text-space"
                    style={{ background: "var(--color-accent)" }}
                  >
                    {t("circle.join")}
                  </button>
                )}
              </div>
            </div>

            {asking && about.mine && (
              <AskComposer
                circleId={circleId}
                topicId={topicId}
                // Curated vocabulary first, then anything already in use, so
                // the offered list is consistent without hiding organic tags.
                knownTags={[...new Set([...suggestedTags, ...tags.map((x) => x.tag)])]}
                onDone={(created) => {
                  setAsking(false);
                  if (created) void loadPosts();
                }}
              />
            )}

            {!about.mine && (
              <p className="mb-3 rounded-xl border border-line bg-[var(--color-tint-soft)] px-3 py-2 text-[12px] text-[var(--color-dim)]">
                {t("forum.joinToPost")}
              </p>
            )}

            {posts.length === 0 ? (
              <p className="py-10 text-center text-[13px] text-[var(--color-faint)]">{t("forum.noPosts")}</p>
            ) : (
              <div className="space-y-2">
                {posts.map((p) => (
                  <PostCard key={p.id} post={p} author={authors[p.authorId]} />
                ))}
              </div>
            )}
          </div>

          <div className="min-w-0">
            <CircleSidebar about={about} />
          </div>
        </div>
      </div>
    </div>
  );
}

function AskComposer({
  circleId,
  topicId,
  knownTags,
  onDone,
}: {
  circleId: string;
  topicId: string | null;
  /** Tags already used in this circle — picking beats free-typing, which is
   *  how you end up with visa/Visa/visas as three different tags. */
  knownTags: string[];
  onDone: (created: boolean) => void;
}) {
  const t = useT();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await createPost(circleId, { topicId, title, body, tags });
      onDone(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="mb-3 rounded-2xl border border-line bg-[var(--color-surface)] p-3.5">
      <input
        dir="auto"
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t("forum.askTitlePlaceholder")}
        maxLength={200}
        className="w-full rounded-xl border border-line bg-transparent px-3 py-2.5 text-[16px] text-ink outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-accent-line)] md:text-[13.5px]"
      />
      <textarea
        dir="auto"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={4}
        placeholder={t("forum.askBodyPlaceholder")}
        className="mt-2 w-full resize-none rounded-xl border border-line bg-transparent px-3 py-2.5 text-[16px] leading-relaxed text-ink outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-accent-line)] md:text-[13.5px]"
      />
      {knownTags.length > 0 && (
        <div className="mt-2">
          <div className="mb-1 text-[11px] text-[var(--color-faint)]">{t("forum.tagsHint")}</div>
          <div className="flex flex-wrap gap-1.5">
            {knownTags.map((x) => {
              const on = tags.includes(x);
              return (
                <button
                  key={x}
                  type="button"
                  onClick={() => setTags((ts) => (on ? ts.filter((v) => v !== x) : [...ts, x]))}
                  className="rounded-full border px-2.5 py-1 text-[11.5px] capitalize transition"
                  style={
                    on
                      ? { borderColor: "var(--color-accent-line)", background: "var(--color-accent-soft)", color: "var(--color-accent)" }
                      : { borderColor: "var(--color-line)", color: "var(--color-dim)" }
                  }
                >
                  {x.replace(/_/g, " ")}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {err && <p className="mt-1.5 text-[12px] text-rose-300">{err}</p>}
      <div className="mt-2 flex justify-end gap-2">
        <button onClick={() => onDone(false)} className="rounded-xl border border-line px-3 py-1.5 text-[12.5px] text-[var(--color-dim)]">
          {t("common.cancel")}
        </button>
        <button
          onClick={() => void submit()}
          disabled={busy || !title.trim()}
          className="rounded-xl px-3.5 py-1.5 text-[12.5px] font-bold text-space disabled:opacity-50"
          style={{ background: "var(--color-accent)" }}
        >
          {busy ? t("common.saving") : t("forum.askSubmit")}
        </button>
      </div>
    </div>
  );
}

function TopicComposer({ circleId, onDone }: { circleId: string; onDone: (created: boolean) => void }) {
  const t = useT();
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!label.trim() || busy) return;
    setBusy(true);
    try {
      await createTopic(circleId, { label, description });
      onDone(true);
    } catch {
      setBusy(false);
    }
  };

  return (
    <div className="mb-3 rounded-2xl border border-line bg-[var(--color-surface)] p-3.5">
      <input
        dir="auto"
        autoFocus
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder={t("forum.topicLabel")}
        maxLength={80}
        className="w-full rounded-xl border border-line bg-transparent px-3 py-2 text-[16px] text-ink outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-accent-line)] md:text-[13.5px]"
      />
      <input
        dir="auto"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder={t("forum.topicDescription")}
        maxLength={300}
        className="mt-2 w-full rounded-xl border border-line bg-transparent px-3 py-2 text-[16px] text-ink outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-accent-line)] md:text-[13.5px]"
      />
      <div className="mt-2 flex justify-end gap-2">
        <button onClick={() => onDone(false)} className="rounded-xl border border-line px-3 py-1.5 text-[12.5px] text-[var(--color-dim)]">
          {t("common.cancel")}
        </button>
        <button
          onClick={() => void submit()}
          disabled={busy || !label.trim()}
          className="rounded-xl px-3.5 py-1.5 text-[12.5px] font-bold text-space disabled:opacity-50"
          style={{ background: "var(--color-accent)" }}
        >
          {busy ? t("common.saving") : t("common.save")}
        </button>
      </div>
    </div>
  );
}
