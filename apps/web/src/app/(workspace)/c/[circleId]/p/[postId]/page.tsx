"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, CheckCircle2, Loader2, Lock, Pin, Trash2 } from "lucide-react";
import SpecialistAvatar from "@/components/specialist/SpecialistAvatar";
import VoteControl from "@/components/forum/VoteControl";
import BadgeRow from "@/components/forum/BadgeRow";
import {
  acceptAnswer,
  createAnswer,
  deleteAnswer,
  fetchThread,
  moderatePost,
  voteAnswer,
  votePost,
  type Answer,
  type Author,
  type Post,
} from "@/lib/forumClient";
import { useI18n } from "@/lib/i18n";

/** One question thread. Accepted answer floats to the top, then by score —
 *  the whole point is that the best answer is never buried. */
export default function ThreadPage({ params }: { params: Promise<{ circleId: string; postId: string }> }) {
  const { circleId, postId } = use(params);
  const { t, locale } = useI18n();

  const [post, setPost] = useState<Post | null>(null);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [authors, setAuthors] = useState<Record<string, Author>>({});
  const [canModerate, setCanModerate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);

  const load = useCallback(async () => {
    const r = await fetchThread(postId);
    setPost(r.post);
    setAnswers(r.answers);
    setAuthors(r.authors);
    setCanModerate(r.canModerate);
  }, [postId]);

  useEffect(() => {
    let alive = true;
    load()
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [load]);

  const submit = async () => {
    if (!body.trim() || posting) return;
    setPosting(true);
    try {
      await createAnswer(postId, { body });
      setBody("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPosting(false);
    }
  };

  if (loading) {
    return (
      <div className="grid h-full place-items-center text-[var(--color-dim)]">
        <Loader2 className="animate-spin" size={20} />
      </div>
    );
  }
  if (error || !post) return <div className="p-6 text-[13px] text-rose-300">{error ?? "not found"}</div>;

  const author = authors[post.authorId];

  return (
    <div className="scroll-quiet h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[760px] px-4 py-4">
        <Link
          href={`/c/${encodeURIComponent(circleId)}`}
          className="mb-3 inline-flex items-center gap-1.5 text-[12.5px] text-[var(--color-faint)] hover:text-ink"
        >
          <ArrowLeft size={14} className="rtl:rotate-180" /> {t("common.back")}
        </Link>

        {/* question */}
        <article className="flex gap-3 rounded-2xl border border-line bg-[var(--color-surface)] p-4">
          <VoteControl
            score={post.score}
            myVote={post.myVote}
            onVote={(v) => votePost(post.id, v).then((r) => ({ score: r.score, myVote: r.myVote }))}
          />
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-1.5">
              {post.pinned && (
                <span className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                  style={{ background: "var(--color-accent-soft)", color: "var(--color-accent)" }}>
                  <Pin size={9} /> {t("forum.pinned")}
                </span>
              )}
              {post.locked && (
                <span className="inline-flex items-center gap-0.5 rounded-full border border-line px-1.5 py-0.5 text-[10px] text-[var(--color-faint)]">
                  <Lock size={9} /> {t("forum.locked")}
                </span>
              )}
            </div>
            <h1 dir="auto" className="text-[19px] font-extrabold leading-snug text-ink" style={{ fontFamily: "var(--font-display)" }}>
              {post.title}
            </h1>
            {post.body && (
              <p dir="auto" className="mt-2 whitespace-pre-wrap text-[13.5px] leading-relaxed text-[var(--color-dim)]">
                {post.body}
              </p>
            )}
            {author && (
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--color-faint)]">
                <SpecialistAvatar label={author.label} photoUrl={author.photoUrl} size={18} rounded="rounded-full" />
                <span className="text-[var(--color-dim)]">{author.label}</span>
                <BadgeRow badges={author.badges} karma={author.karma} locale={locale} />
              </div>
            )}
            {canModerate && (
              <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-2.5">
                <ModButton
                  label={post.pinned ? t("forum.unpin") : t("forum.pin")}
                  icon={<Pin size={12} />}
                  onClick={async () => {
                    await moderatePost(post.id, { pinned: !post.pinned });
                    await load();
                  }}
                />
                <ModButton
                  label={post.locked ? t("forum.unlock") : t("forum.lock")}
                  icon={<Lock size={12} />}
                  onClick={async () => {
                    await moderatePost(post.id, { locked: !post.locked });
                    await load();
                  }}
                />
              </div>
            )}
          </div>
        </article>

        {/* answers */}
        <h2 className="mb-2 mt-5 text-[12px] font-semibold uppercase tracking-[0.14em] text-[var(--color-faint)]">
          {t("forum.answers", { count: post.answerCount })}
        </h2>

        {answers.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-[var(--color-faint)]">{t("forum.noAnswers")}</p>
        ) : (
          <div className="space-y-2">
            {answers.map((a) => (
              <AnswerRow
                key={a.id}
                answer={a}
                author={authors[a.authorId]}
                locale={locale}
                canAccept={!a.accepted && !a.deleted}
                showAcceptControl={canModerate}
                onChanged={load}
              />
            ))}
          </div>
        )}

        {/* composer */}
        {post.locked ? (
          <p className="mt-4 rounded-xl border border-line px-3 py-2 text-[12.5px] text-[var(--color-faint)]">
            {t("forum.lockedNotice")}
          </p>
        ) : (
          <div className="mt-4 rounded-2xl border border-line bg-[var(--color-surface)] p-3.5">
            <textarea
              dir="auto"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              placeholder={t("forum.answerPlaceholder")}
              className="w-full resize-none rounded-xl border border-line bg-transparent px-3 py-2.5 text-[16px] leading-relaxed text-ink outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-accent-line)] md:text-[13.5px]"
            />
            <div className="mt-2 flex justify-end">
              <button
                onClick={() => void submit()}
                disabled={posting || !body.trim()}
                className="rounded-xl px-3.5 py-1.5 text-[12.5px] font-bold text-space disabled:opacity-50"
                style={{ background: "var(--color-accent)" }}
              >
                {posting ? t("common.saving") : t("forum.answerSubmit")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ModButton({ label, icon, onClick }: { label: string; icon: React.ReactNode; onClick: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await onClick();
        } finally {
          setBusy(false);
        }
      }}
      className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-[11.5px] text-[var(--color-dim)] hover:text-ink disabled:opacity-50"
    >
      {busy ? <Loader2 size={12} className="animate-spin" /> : icon} {label}
    </button>
  );
}

function AnswerRow({
  answer,
  author,
  locale,
  canAccept,
  showAcceptControl,
  onChanged,
}: {
  answer: Answer;
  author?: Author;
  locale: string;
  canAccept: boolean;
  showAcceptControl: boolean;
  onChanged: () => Promise<void>;
}) {
  const { t } = useI18n();

  if (answer.deleted) {
    return (
      <div className="rounded-2xl border border-line px-3.5 py-2 text-[12px] italic text-[var(--color-faint)]">
        {t("forum.deleted")}
      </div>
    );
  }

  return (
    <article
      className="flex gap-3 rounded-2xl border p-3.5"
      style={
        answer.accepted
          ? { borderColor: "rgba(84,210,110,0.4)", background: "rgba(84,210,110,0.06)" }
          : { borderColor: "var(--color-line)", background: "var(--color-surface)" }
      }
    >
      <VoteControl
        size="sm"
        score={answer.score}
        myVote={answer.myVote}
        onVote={(v) => voteAnswer(answer.id, v).then((r) => ({ score: r.score, myVote: r.myVote }))}
      />
      <div className="min-w-0 flex-1">
        {answer.accepted && (
          <div className="mb-1 inline-flex items-center gap-1 text-[10.5px] font-bold" style={{ color: "#54d26e" }}>
            <CheckCircle2 size={11} /> {t("forum.accepted")}
          </div>
        )}
        <p dir="auto" className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink">
          {answer.body}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--color-faint)]">
          {author && (
            <>
              <SpecialistAvatar label={author.label} photoUrl={author.photoUrl} size={18} rounded="rounded-full" />
              <span className="text-[var(--color-dim)]">{author.label}</span>
              <BadgeRow badges={author.badges} karma={author.karma} locale={locale} />
            </>
          )}
          {showAcceptControl && canAccept && (
            <button
              onClick={async () => {
                await acceptAnswer(answer.id).catch(() => undefined);
                await onChanged();
              }}
              className="ms-auto inline-flex items-center gap-1 rounded-lg border border-line px-2 py-0.5 text-[11px] hover:text-ink"
            >
              <Check size={11} /> {t("forum.accept")}
            </button>
          )}
          {showAcceptControl && (
            <button
              onClick={async () => {
                await deleteAnswer(answer.id).catch(() => undefined);
                await onChanged();
              }}
              aria-label={t("forum.remove")}
              className="text-[var(--color-faint)] hover:text-rose-300"
            >
              <Trash2 size={11} />
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
