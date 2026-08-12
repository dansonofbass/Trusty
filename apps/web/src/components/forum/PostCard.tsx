"use client";

import Link from "next/link";
import { Lock, MessageSquare, Pin } from "lucide-react";
import SpecialistAvatar from "@/components/specialist/SpecialistAvatar";
import VoteControl from "./VoteControl";
import BadgeRow from "./BadgeRow";
import { votePost, type Author, type Post } from "@/lib/forumClient";
import { useI18n } from "@/lib/i18n";

/** The answer's first sentence, then the rest. A good answer opens with the
 *  verdict ("نه — اصل ترجمه را نگه می‌دارند"), so promoting that one line to
 *  bold is what makes a list skimmable. Splits on Persian and Latin
 *  sentence ends, or the first line break, whichever comes first. */
function splitLead(preview: string): [string, string] {
  const text = (preview ?? "").trim();
  if (!text) return ["", ""];
  const cut = text.search(/[.!?؟۔]\s|\n/);
  // No sentence end in a short answer: the whole thing is the lead.
  if (cut < 0) return [text.length <= 160 ? text : `${text.slice(0, 160).trim()}…`, ""];
  const lead = text.slice(0, cut + 1).trim();
  const rest = text.slice(cut + 1).trim();
  // A very long first sentence is a paragraph, not a verdict — don't bold it all.
  if (lead.length > 180) return ["", text];
  return [lead, rest];
}

/** One question in a list. Shows the accepted answer's opening when there is
 *  one, the asker's context when there is not.
 *  `circleLabel` is set only by lists that mix circles (the merged feed), where
 *  a card without its origin is ambiguous. */
export default function PostCard({
  post,
  author,
  circleLabel,
}: {
  post: Post;
  author?: Author;
  circleLabel?: string;
}) {
  const { t, locale } = useI18n();
  const [answerLead, answerRest] = splitLead(post.answerPreview);

  return (
    <article className="flex gap-3 rounded-2xl border border-line bg-[var(--color-surface)] p-3.5 backdrop-blur-md transition hover:border-[var(--color-accent-line)]">
      <VoteControl
        score={post.score}
        myVote={post.myVote}
        onVote={(v) => votePost(post.id, v).then((r) => ({ score: r.score, myVote: r.myVote }))}
      />

      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-1.5">
          {circleLabel && (
            <Link
              href={`/c/${encodeURIComponent(post.circleId)}`}
              dir="auto"
              className="rounded-full border border-line px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-dim)] transition hover:text-ink"
            >
              {circleLabel}
            </Link>
          )}
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
          {/* Answered questions lead with the ANSWER: a card showing only the
              question makes you open the page to learn whether it was ever
              answered. Unanswered ones fall back to the asker's own context. */}
          {answerLead || answerRest ? (
            <>
              {answerLead && (
                <p dir="auto" className="mt-1.5 text-[13px] font-semibold leading-relaxed text-ink">
                  {answerLead}
                </p>
              )}
              {answerRest && (
                <p
                  dir="auto"
                  className={`line-clamp-2 text-[12.5px] leading-relaxed text-[var(--color-dim)] ${answerLead ? "mt-1" : "mt-1.5"}`}
                >
                  {answerRest}
                </p>
              )}
            </>
          ) : (
            post.body && (
              <p dir="auto" className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-[var(--color-dim)]">
                {post.body}
              </p>
            )
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
