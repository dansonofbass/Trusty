"use client";

import Link from "next/link";
import { Lock, MessageSquare, Pin } from "lucide-react";
import SpecialistAvatar from "@/components/specialist/SpecialistAvatar";
import VoteControl from "./VoteControl";
import BadgeRow from "./BadgeRow";
import { votePost, type Author, type Post } from "@/lib/forumClient";
import { useI18n } from "@/lib/i18n";

/** One question in a list. Body is clamped — the thread page has the rest. */
export default function PostCard({ post, author }: { post: Post; author?: Author }) {
  const { t, locale } = useI18n();

  return (
    <article className="flex gap-3 rounded-2xl border border-line bg-[var(--color-surface)] p-3.5 backdrop-blur-md transition hover:border-[var(--color-accent-line)]">
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

        <Link href={`/c/${encodeURIComponent(post.circleId)}/p/${encodeURIComponent(post.id)}`} className="block">
          <h3 dir="auto" className="text-[14.5px] font-bold leading-snug text-ink hover:underline">
            {post.title}
          </h3>
          {post.body && (
            <p dir="auto" className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-[var(--color-dim)]">
              {post.body}
            </p>
          )}
        </Link>

        {post.tags.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {post.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full px-1.5 py-0.5 text-[10px] font-medium capitalize"
                style={{ background: "var(--color-tint)", color: "var(--color-dim)" }}
              >
                {tag.replace(/_/g, " ")}
              </span>
            ))}
          </div>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-[var(--color-faint)]">
          {author && (
            <span className="inline-flex items-center gap-1.5">
              <SpecialistAvatar label={author.label} photoUrl={author.photoUrl} size={18} rounded="rounded-full" />
              <span className="text-[var(--color-dim)]">{author.label}</span>
              <BadgeRow badges={author.badges} karma={author.karma} locale={locale} />
            </span>
          )}
          <span className="inline-flex items-center gap-1">
            <MessageSquare size={11} /> {t("forum.answers", { count: post.answerCount })}
          </span>
        </div>
      </div>
    </article>
  );
}
