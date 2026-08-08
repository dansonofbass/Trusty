"use client";

/**
 * CommunityFeed — the irham front door, rebuilt around topics.
 *
 * The old front door was a wall of seven buttons with the actual knowledge one
 * tap behind "Join circles". That inverts the value: someone arriving from a
 * Telegram link wants to SEE that their question has already been answered,
 * not to pick a circle first. So this screen is a single merged feed of every
 * question in the space, with the circles reduced to a filter row on top.
 *
 * Everything here goes through t() — irham is Persian-first and RTL, so layout
 * uses logical properties (ms-*, text-start) and never branches on locale.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MessageSquarePlus, Search, Sparkles, X } from "lucide-react";
import PostCard from "@/components/forum/PostCard";
import { fetchFeed, type FeedCircle, type FeedPage } from "@/lib/feedClient";
import { createPost, type PostSort } from "@/lib/forumClient";
import { joinCircle } from "@/lib/socialClient";
import { spaceFromHost, SPACE_META } from "@/lib/space";
import { useUI } from "@/lib/store";
import { useT } from "@/lib/i18n";

const SORTS: PostSort[] = ["new", "hot", "top"];

export default function CommunityFeed() {
  const t = useT();
  const router = useRouter();
  const setChatPrefill = useUI((s) => s.setChatPrefill);

  const [feed, setFeed] = useState<FeedPage | null>(null);
  const [circleId, setCircleId] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [sort, setSort] = useState<PostSort>("new");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  const space = spaceFromHost();
  const meta = space ? SPACE_META[space] : null;

  const load = useCallback(() => fetchFeed({ circleId, tag, sort, limit: 60 }), [circleId, tag, sort]);

  useEffect(() => {
    // The guard matters here: tapping through the topic chips fires several
    // requests, and without it a slow earlier one can land last and win.
    let alive = true;
    setError(null);
    load()
      .then((page) => alive && setFeed(page))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [load]);

  // Search is client-side over the loaded page on purpose: it must feel instant
  // while typing, and 60 questions is nothing to filter. Falling back to the
  // assistant (below) is what covers "not in this page".
  const posts = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !feed) return feed?.posts ?? [];
    return feed.posts.filter((p) =>
      `${p.title} ${p.body} ${p.tags.join(" ")}`.toLowerCase().includes(q),
    );
  }, [feed, query]);

  const circle = feed?.circles.find((c) => c.id === circleId) ?? null;
  const totalQuestions = feed?.circles.reduce((n, c) => n + c.postCount, 0) ?? 0;

  const pickCircle = (id: string | null) => {
    setCircleId(id);
    setTag(null);
  };

  /** Hand the typed question to the agent, which answers in the language asked. */
  const askAssistant = () => {
    setChatPrefill(query.trim() || " ");
    router.push("/ask");
  };

  const chip = (active: boolean) =>
    active
      ? { borderColor: "var(--color-accent-line)", background: "var(--color-accent-soft)", color: "var(--color-accent)" }
      : { borderColor: "var(--color-line)", color: "var(--color-dim)" };

  return (
    <div className="scroll-quiet h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[760px] px-4 py-5">
        <header className="mb-4 text-center">
          <h1
            className="text-[22px] font-extrabold leading-tight text-ink md:text-[26px]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {meta?.emoji} {t("community.title")}
          </h1>
          <p className="mt-1 text-[13px] leading-relaxed text-[var(--color-dim)]">{t("community.tagline")}</p>
        </header>

        {/* Search — the first thing a newcomer should reach for, because the
            odds are their question is already answered below. */}
        <div className="relative mb-3">
          <Search
            size={15}
            className="pointer-events-none absolute inset-y-0 my-auto ms-3.5 text-[var(--color-faint)]"
          />
          <input
            dir="auto"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("feed.searchPlaceholder")}
            className="w-full rounded-2xl border border-line bg-[var(--color-surface)] py-3 pe-10 ps-10 text-[16px] text-ink outline-none backdrop-blur-md transition placeholder:text-[var(--color-faint)] focus:border-[var(--color-accent-line)] md:text-[13.5px]"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label={t("common.cancel")}
              className="absolute inset-y-0 end-0 my-auto me-3 h-5 text-[var(--color-faint)] transition hover:text-ink"
            >
              <X size={15} />
            </button>
          )}
        </div>

        {/* Topics — the circles, as a filter row rather than a gate. */}
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => pickCircle(null)}
            className="rounded-full border px-3 py-1.5 text-[12px] font-semibold transition"
            style={chip(circleId === null)}
          >
            {t("feed.allTopics")}
            {totalQuestions > 0 && <span className="ms-1.5 text-[10px] text-[var(--color-faint)]">{totalQuestions}</span>}
          </button>
          {(feed?.circles ?? []).map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => pickCircle(c.id)}
              title={c.description || undefined}
              className="rounded-full border px-3 py-1.5 text-[12px] font-semibold transition"
              style={chip(circleId === c.id)}
            >
              <span dir="auto">{c.label}</span>
              <span className="ms-1.5 text-[10px] text-[var(--color-faint)]">{c.postCount}</span>
            </button>
          ))}
        </div>

        {/* A chosen topic reveals its own vocabulary — the tags only make sense
            inside one circle, so they appear only once one is selected. */}
        {circle && (feed?.tags.length ?? 0) > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            {tag && (
              <button
                type="button"
                onClick={() => setTag(null)}
                className="rounded-full border border-line px-2.5 py-1 text-[11.5px] text-[var(--color-faint)] transition hover:text-ink"
              >
                ✕ {t("forum.clearTag")}
              </button>
            )}
            {feed!.tags.map((x) => (
              <button
                key={x.tag}
                type="button"
                onClick={() => setTag(tag === x.tag ? null : x.tag)}
                className="rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition"
                style={chip(tag === x.tag)}
              >
                <span dir="auto">{x.tag.replace(/_/g, " ")}</span>
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
                type="button"
                onClick={() => setSort(s)}
                className="rounded-full px-2.5 py-1 text-[11.5px] font-semibold transition"
                style={
                  sort === s
                    ? { background: "var(--color-accent-soft)", color: "var(--color-accent)" }
                    : { color: "var(--color-faint)" }
                }
              >
                {t(s === "hot" ? "forum.sortHot" : s === "new" ? "forum.sortNew" : "forum.sortTop")}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setAsking((v) => !v)}
            className="ms-auto flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-[12.5px] font-bold"
            style={{ background: "var(--color-accent)", color: "var(--color-on-accent)" }}
          >
            <MessageSquarePlus size={14} /> {t("forum.ask")}
          </button>
        </div>

        {asking && feed && (
          <AskSheet
            circles={feed.circles}
            initialCircleId={circleId}
            initialTitle={query.trim()}
            onDone={(created) => {
              setAsking(false);
              if (created) void load().then(setFeed).catch(() => undefined);
            }}
          />
        )}

        {circle?.description && !asking && (
          <p dir="auto" className="mb-3 rounded-xl border border-line bg-[var(--color-tint-soft)] px-3 py-2 text-[12px] leading-relaxed text-[var(--color-dim)]">
            {circle.description}
          </p>
        )}

        {error ? (
          <p className="py-10 text-center text-[13px] text-rose-300">{error}</p>
        ) : !feed ? (
          <div className="grid place-items-center py-16 text-[var(--color-dim)]">
            <Loader2 className="animate-spin" size={20} />
          </div>
        ) : posts.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line px-4 py-10 text-center">
            <p className="text-[13px] text-[var(--color-dim)]">
              {query ? t("feed.noResults") : t("forum.noPosts")}
            </p>
            <p className="mt-1 text-[12px] text-[var(--color-faint)]">{t("feed.noResultsHint")}</p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <button
                type="button"
                onClick={() => setAsking(true)}
                className="rounded-xl px-3.5 py-2 text-[12.5px] font-bold"
                style={{ background: "var(--color-accent)", color: "var(--color-on-accent)" }}
              >
                {t("feed.askCommunity")}
              </button>
              <button
                type="button"
                onClick={askAssistant}
                className="flex items-center gap-1.5 rounded-xl border border-line px-3.5 py-2 text-[12.5px] font-semibold text-[var(--color-dim)] transition hover:text-ink"
              >
                <Sparkles size={13} /> {t("feed.askAssistant")}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              {posts.map((p) => (
                <PostCard
                  key={p.id}
                  post={p}
                  author={feed.authors[p.authorId]}
                  // The merged feed mixes circles, so each card says where it
                  // came from — without it, "قرارداد" is ambiguous.
                  circleLabel={circleId ? undefined : feed.circles.find((c) => c.id === p.circleId)?.label}
                />
              ))}
            </div>
            {query && (
              <button
                type="button"
                onClick={askAssistant}
                className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-line px-3.5 py-2.5 text-[12.5px] font-semibold text-[var(--color-dim)] transition hover:border-[var(--color-accent-line)] hover:text-ink"
              >
                <Sparkles size={13} /> {t("feed.askAssistant")}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Asking, from the feed. The circle is a field in the form rather than
 * somewhere you had to navigate first, and joining happens implicitly on
 * submit — "join before you may ask" is a rule that only ever cost us
 * questions.
 */
function AskSheet({
  circles,
  initialCircleId,
  initialTitle,
  onDone,
}: {
  circles: FeedCircle[];
  initialCircleId: string | null;
  /** What they typed into search — most people search, find nothing, then ask. */
  initialTitle: string;
  onDone: (created: boolean) => void;
}) {
  const t = useT();
  const [circleId, setCircleId] = useState(initialCircleId ?? circles[0]?.id ?? "");
  const [title, setTitle] = useState(initialTitle);
  const [body, setBody] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const circle = circles.find((c) => c.id === circleId);
  // Switching circle invalidates the picked tags: vocabularies are per-circle.
  const chooseCircle = (id: string) => {
    setCircleId(id);
    setTags([]);
  };

  const submit = async () => {
    if (!title.trim() || !circleId || busy) return;
    setBusy(true);
    setErr(null);
    try {
      if (circle && !circle.mine) await joinCircle(circleId).catch(() => undefined);
      await createPost(circleId, { title, body, tags });
      onDone(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="mb-3 rounded-2xl border border-line bg-[var(--color-surface)] p-3.5">
      <div className="mb-2">
        <div className="mb-1 text-[11px] text-[var(--color-faint)]">{t("feed.pickTopic")}</div>
        <div className="flex flex-wrap gap-1.5">
          {circles.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => chooseCircle(c.id)}
              className="rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition"
              style={
                circleId === c.id
                  ? { borderColor: "var(--color-accent-line)", background: "var(--color-accent-soft)", color: "var(--color-accent)" }
                  : { borderColor: "var(--color-line)", color: "var(--color-dim)" }
              }
            >
              <span dir="auto">{c.label}</span>
            </button>
          ))}
        </div>
      </div>

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

      {(circle?.suggestedTags.length ?? 0) > 0 && (
        <div className="mt-2">
          <div className="mb-1 text-[11px] text-[var(--color-faint)]">{t("forum.tagsHint")}</div>
          <div className="flex flex-wrap gap-1.5">
            {circle!.suggestedTags.map((x) => {
              const on = tags.includes(x);
              return (
                <button
                  key={x}
                  type="button"
                  onClick={() => setTags((ts) => (on ? ts.filter((v) => v !== x) : [...ts, x]))}
                  className="rounded-full border px-2.5 py-1 text-[11.5px] transition"
                  style={
                    on
                      ? { borderColor: "var(--color-accent-line)", background: "var(--color-accent-soft)", color: "var(--color-accent)" }
                      : { borderColor: "var(--color-line)", color: "var(--color-dim)" }
                  }
                >
                  <span dir="auto">{x.replace(/_/g, " ")}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {err && <p className="mt-1.5 text-[12px] text-rose-300">{err}</p>}
      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => onDone(false)}
          className="rounded-xl border border-line px-3 py-1.5 text-[12.5px] text-[var(--color-dim)]"
        >
          {t("common.cancel")}
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || !title.trim() || !circleId}
          className="rounded-xl px-3.5 py-1.5 text-[12.5px] font-bold disabled:opacity-50"
          style={{ background: "var(--color-accent)", color: "var(--color-on-accent)" }}
        >
          {busy ? t("common.saving") : t("forum.askSubmit")}
        </button>
      </div>
    </div>
  );
}
