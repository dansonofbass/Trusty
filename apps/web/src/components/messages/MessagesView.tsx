"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, BadgeCheck, Bookmark, BookmarkCheck, Check, CornerUpLeft, Link as LinkIcon, Loader2, LogOut, MessagesSquare, Plus, Send, Trash2, Users, X } from "lucide-react";
import { useUI } from "@/lib/store";
import {
  createCircle,
  deleteRoomMessage,
  fetchCircles,
  fetchRoomAnswers,
  fetchRoomMessages,
  fetchRooms,
  leaveCircle,
  markRoomRead,
  saveMessageAsAnswer,
  sendRoomMessage,
  type RoomMessage,
  type RoomSummary,
  type RoomThread,
  type SavedAnswer,
} from "@/lib/socialClient";
import {
  fetchSpecialistsByTopics,
  telegramUrl,
  SPECIALIST_TYPE_FA,
  TRUST_LABEL_FA,
  type SpecialistCard,
} from "@/lib/specialistClient";

const POLL_MS = 4000;

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** Stable per-sender accent so a busy group thread stays scannable. */
const SENDER_COLORS = ["#ff8c5a", "#3fc6f4", "#54d26e", "#e25cff", "#f4c63f", "#9af0c8", "#92a6ff"];
const senderColor = (id: string) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return SENDER_COLORS[h % SENDER_COLORS.length];
};

/** Trusted mentors for this circle — admin-tagged specialists matching the
 *  circle's topicTags (infra/fixtures/circles-iran.json), same trust-ranked
 *  source as the market-test survey and CommunityHome's Experts section.
 *  Only renders for circles that have topics tagged AND at least one match —
 *  a squad chat or an untagged circle shows nothing here. */
function TrustedMentors({ roomId }: { roomId: string }) {
  const [mentors, setMentors] = useState<SpecialistCard[] | null>(null);

  useEffect(() => {
    let alive = true;
    setMentors(null);
    fetchCircles()
      .then(async (r) => {
        const circle = r.circles.find((c) => c.roomId === roomId);
        const topics = circle?.topicTags ?? [];
        if (!topics.length) return alive && setMentors([]);
        const list = await fetchSpecialistsByTopics(topics, 3);
        if (alive) setMentors(list.slice(0, 3));
      })
      .catch(() => alive && setMentors([]));
    return () => {
      alive = false;
    };
  }, [roomId]);

  if (!mentors || mentors.length === 0) return null;

  return (
    <div className="border-b border-line px-3 py-2 md:px-5">
      <div className="mx-auto flex w-full max-w-[760px] gap-2 overflow-x-auto scroll-quiet">
        {mentors.map((m) => (
          <div
            key={m.nodeId}
            className="flex shrink-0 items-center gap-2 rounded-xl border border-line bg-[var(--color-surface)] px-3 py-2"
          >
            <span className="min-w-0">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-[12.5px] font-semibold text-ink">{m.label}</span>
                {m.verified && <BadgeCheck size={12} style={{ color: "var(--color-accent)" }} />}
              </span>
              <span className="block text-[10.5px] text-[var(--color-dim)]">
                {SPECIALIST_TYPE_FA[m.nodeType] ?? m.nodeType} · {TRUST_LABEL_FA[m.trustLabel] ?? m.trustLabelText}
              </span>
            </span>
            {m.telegramHandle ? (
              <a
                href={telegramUrl(m.telegramHandle)}
                target="_blank"
                rel="noreferrer"
                className="flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[10.5px] font-bold"
                style={{ background: "var(--color-accent)", color: "var(--color-on-accent)" }}
              >
                <Send size={11} /> تلگرام
              </a>
            ) : (
              <a
                href={`/s/${encodeURIComponent(m.nodeId)}`}
                className="shrink-0 rounded-full px-2.5 py-1 text-[10.5px] font-bold"
                style={{ background: "rgba(146,166,255,0.12)", color: "var(--color-ink)" }}
              >
                پروفایل
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Thread({ roomId, onBack }: { roomId: string; onBack: () => void }) {
  const select = useUI((s) => s.select);
  const [thread, setThread] = useState<RoomThread | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState<RoomMessage | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);
  const [answersOpen, setAnswersOpen] = useState(false);
  const [answers, setAnswers] = useState<SavedAnswer[] | null>(null);
  /** messageId → answerId, so a saved message can be shared by its public link. */
  const [answerIdOf, setAnswerIdOf] = useState<Map<number, number>>(new Map());
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [sharing, setSharing] = useState<number | null>(null);
  const [shareTarget, setShareTarget] = useState<{ answerId: number; body: string } | null>(null);
  const [leaving, setLeaving] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);

  const leave = async () => {
    if (!thread?.room.refId || leaving) return;
    if (!confirm(`Leave "${thread.room.title}"? You can rejoin later if it's open.`)) return;
    setLeaving(true);
    try {
      await leaveCircle(thread.room.refId);
      onBack();
    } catch {
      setLeaving(false);
    }
  };

  const indexAnswers = (list: SavedAnswer[]) =>
    setAnswerIdOf(new Map(list.filter((a) => a.messageId).map((a) => [a.messageId as number, a.id])));

  const openAnswers = () => {
    setAnswersOpen(true);
    fetchRoomAnswers(roomId)
      .then((r) => {
        setAnswers(r.answers);
        indexAnswers(r.answers);
      })
      .catch(() => setAnswers([]));
  };

  /**
   * One tap to share: a message must exist as a saved ANSWER to have a public
   * link, so if it isn't saved yet we save it first (that's also what makes it
   * findable by the assistant later) and then open the share sheet.
   */
  const share = async (m: RoomMessage) => {
    setSharing(m.id);
    try {
      let answerId = answerIdOf.get(m.id);
      if (!answerId) {
        await saveMessageAsAnswer(roomId, m.id);
        const r = await fetchRoomAnswers(roomId);
        indexAnswers(r.answers);
        answerId = r.answers.find((a) => a.messageId === m.id)?.id;
      }
      if (answerId) setShareTarget({ answerId, body: m.body });
    } catch (e) {
      setError(e instanceof Error ? e.message : "couldn't share that message");
    } finally {
      setSharing(null);
    }
  };

  const load = useCallback(() => {
    fetchRoomMessages(roomId)
      .then((t) => {
        setThread(t);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "couldn't load the room"));
  }, [roomId]);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    void markRoomRead(roomId).catch(() => {});
    fetchRoomAnswers(roomId)
      .then((r) => indexAnswers(r.answers))
      .catch(() => {});
    return () => clearInterval(t);
  }, [load, roomId]);

  // Pin to the newest message unless the reader scrolled up.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [thread]);

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setText("");
    try {
      const r = await sendRoomMessage(roomId, body, replyTo?.id);
      setReplyTo(null);
      setThread((t) => (t ? { ...t, messages: [...t.messages, r.message] } : t));
      stickToBottom.current = true;
    } catch {
      setText(body); // give the draft back on failure
    } finally {
      setSending(false);
    }
  };

  const remove = async (m: RoomMessage) => {
    await deleteRoomMessage(roomId, m.id).catch(() => {});
    setThread((t) =>
      t
        ? { ...t, messages: t.messages.map((x) => (x.id === m.id ? { ...x, deleted: true, body: "" } : x)) }
        : t,
    );
  };

  const byId = new Map((thread?.messages ?? []).map((m) => [m.id, m] as const));

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-[13px] text-[var(--color-dim)]">{error}</p>
        <button type="button" onClick={onBack} className="text-[12px] font-semibold" style={{ color: "var(--color-accent)" }}>
          ← Back to rooms
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2 md:px-5">
        <button type="button" onClick={onBack} aria-label="Back" className="grid h-8 w-8 place-items-center rounded-lg text-[var(--color-dim)] transition hover:text-ink">
          <ArrowLeft size={16} />
        </button>
        <button type="button" onClick={() => setMembersOpen(true)} className="min-w-0 flex-1 text-left" title="See members">
          <div className="truncate text-[13px] font-semibold text-ink" style={{ fontFamily: "var(--font-display)" }}>
            {thread?.room.title ?? "…"}
          </div>
          <div className="text-[10.5px] text-[var(--color-faint)]">
            {thread ? `${thread.members.length} members — tap to see` : ""}
          </div>
        </button>
        <button
          type="button"
          onClick={openAnswers}
          title="Saved answers"
          className="grid h-8 w-8 place-items-center rounded-lg text-[var(--color-dim)] transition hover:text-ink"
        >
          <BookmarkCheck size={15} />
        </button>
        <button
          type="button"
          onClick={() => setMembersOpen(true)}
          aria-label="Members"
          className="grid h-8 w-8 place-items-center rounded-lg text-[var(--color-dim)] transition hover:text-ink"
        >
          <Users size={15} />
        </button>
        {thread?.room.kind === "circle" && (
          <button
            type="button"
            onClick={() => void leave()}
            disabled={leaving}
            title="Leave this circle"
            aria-label="Leave circle"
            className="grid h-8 w-8 place-items-center rounded-lg text-[var(--color-dim)] transition hover:text-rose-300 disabled:opacity-50"
          >
            {leaving ? <Loader2 size={15} className="animate-spin" /> : <LogOut size={15} />}
          </button>
        )}
      </div>

      <TrustedMentors roomId={roomId} />

      {/* Share sheet — one saved answer, every channel. The link is PUBLIC and
          previews in Telegram, so sharing help is how Trusty spreads. */}
      {shareTarget && (() => {
        const url = `${typeof window !== "undefined" ? window.location.origin : ""}/a/${shareTarget.answerId}`;
        const text = shareTarget.body.slice(0, 180);
        const channels = [
          { label: "Telegram", color: "#2AABEE", href: `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}` },
          { label: "WhatsApp", color: "#25D366", href: `https://wa.me/?text=${encodeURIComponent(`${text}

${url}`)}` },
        ];
        return (
          <div className="fixed inset-0 z-[65]">
            <div className="absolute inset-0 bg-black/50" onClick={() => setShareTarget(null)} aria-hidden />
            <div className="absolute inset-x-0 bottom-0 rounded-t-[20px] border border-line bg-[var(--color-card)] p-4 pb-[max(env(safe-area-inset-bottom),16px)] md:inset-x-auto md:left-1/2 md:top-1/2 md:bottom-auto md:w-[420px] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl md:pb-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[13px] font-bold text-ink" style={{ fontFamily: "var(--font-display)" }}>
                  Share this answer
                </span>
                <button type="button" onClick={() => setShareTarget(null)} aria-label="Close">
                  <X size={15} className="text-[var(--color-faint)]" />
                </button>
              </div>
              <p dir="auto" className="mb-3 line-clamp-3 rounded-xl bg-[var(--color-tint-soft)] px-3 py-2 text-[12px] leading-relaxed text-[var(--color-dim)]">
                {shareTarget.body}
              </p>
              <div className="mb-2 flex gap-2">
                {channels.map((c) => (
                  <a
                    key={c.label}
                    href={c.href}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => setShareTarget(null)}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-[13px] font-bold"
                    style={{ background: c.color, color: "#08210f" }}
                  >
                    <Send size={13} /> {c.label}
                  </a>
                ))}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(url);
                    setCopiedId(shareTarget.answerId);
                    setTimeout(() => setCopiedId(null), 1600);
                  }}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-[var(--color-line)] py-2.5 text-[12.5px] font-semibold text-[var(--color-dim)]"
                >
                  {copiedId === shareTarget.answerId ? <Check size={13} /> : <LinkIcon size={13} />}
                  {copiedId === shareTarget.answerId ? "Copied" : "Copy link"}
                </button>
                {typeof navigator !== "undefined" && "share" in navigator && (
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.share?.({ text, url }).catch(() => {});
                      setShareTarget(null);
                    }}
                    className="flex-1 rounded-xl border border-[var(--color-line)] py-2.5 text-[12.5px] font-semibold text-[var(--color-dim)]"
                  >
                    More…
                  </button>
                )}
              </div>
              <p className="mt-2.5 text-center text-[10.5px] leading-snug text-[var(--color-faint)]">
                Anyone can read it without an account — they only need one to ask their own question.
              </p>
            </div>
          </div>
        );
      })()}

      {/* Members sheet */}
      {membersOpen && thread && (
        <div className="fixed inset-0 z-[60]">
          <div className="absolute inset-0 bg-black/45" onClick={() => setMembersOpen(false)} aria-hidden />
          <div className="absolute inset-x-0 bottom-0 max-h-[70dvh] overflow-y-auto rounded-t-[20px] border border-line bg-[var(--color-card)] p-4 md:inset-x-auto md:right-6 md:top-16 md:bottom-auto md:w-[320px] md:rounded-2xl">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[var(--color-faint)]">
                Members · {thread.members.length}
              </span>
              <button type="button" onClick={() => setMembersOpen(false)} aria-label="Close">
                <X size={15} className="text-[var(--color-faint)]" />
              </button>
            </div>
            <ul>
              {thread.members.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setMembersOpen(false);
                      select(m.id);
                    }}
                    className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition hover:bg-[var(--color-tint)]"
                  >
                    <span
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[12px] font-bold"
                      style={{ background: "rgba(146,166,255,0.12)", color: senderColor(m.id) }}
                    >
                      {m.label[0]?.toUpperCase() ?? "?"}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                      {m.label}
                      {m.me && <span className="ml-1 text-[10px] text-[var(--color-faint)]">(you)</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Saved answers sheet */}
      {answersOpen && (
        <div className="fixed inset-0 z-[60]">
          <div className="absolute inset-0 bg-black/45" onClick={() => setAnswersOpen(false)} aria-hidden />
          <div className="absolute inset-x-0 bottom-0 max-h-[75dvh] overflow-y-auto rounded-t-[20px] border border-line bg-[var(--color-card)] p-4 md:inset-x-auto md:right-6 md:top-16 md:bottom-auto md:w-[420px] md:rounded-2xl">
            <div className="mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.14em] text-[var(--color-faint)]">
                <BookmarkCheck size={13} /> Saved answers
              </span>
              <button type="button" onClick={() => setAnswersOpen(false)} aria-label="Close">
                <X size={15} className="text-[var(--color-faint)]" />
              </button>
            </div>
            {answers === null ? (
              <p className="py-4 text-center text-[12px] text-[var(--color-faint)]">Loading…</p>
            ) : answers.length === 0 ? (
              <p className="py-4 text-[12.5px] leading-relaxed text-[var(--color-dim)]">
                Nothing saved yet. Tap the <Bookmark size={11} className="inline" /> on any helpful
                message — it becomes reusable knowledge the assistant can cite, with the author's
                name and date.
              </p>
            ) : (
              <ul className="space-y-2">
                {answers.map((a) => {
                  const url = typeof window !== "undefined" ? `${window.location.origin}/a/${a.id}` : "";
                  return (
                  <li key={a.id} className="rounded-xl border border-line bg-[var(--color-tint-soft)] px-3 py-2">
                    <p dir="auto" className="whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-ink">{a.body}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <p className="min-w-0 flex-1 text-[10.5px] text-[var(--color-faint)]">
                        — {a.authorLabel ?? a.author ?? "someone"}
                        {(a.createdAt ?? a.savedAt) ? ` · ${new Date(a.createdAt ?? a.savedAt!).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}` : ""}
                        {a.topics.length > 0 && ` · ${a.topics.slice(0, 3).map((t) => `#${t}`).join(" ")}`}
                      </p>
                      {/* Sharing is the growth loop: the link reads publicly and
                          previews in Telegram, so helping someone spreads Trusty. */}
                      <button
                        type="button"
                        onClick={() => setShareTarget({ answerId: a.id, body: a.body })}
                        title="Share this answer"
                        className="flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold"
                        style={{ background: "rgba(42,171,238,0.14)", color: "#2AABEE" }}
                      >
                        <Send size={10} /> Share
                      </button>
                      <button
                        type="button"
                        title="Copy link"
                        onClick={() => {
                          void navigator.clipboard?.writeText(url);
                          setCopiedId(a.id);
                          setTimeout(() => setCopiedId(null), 1600);
                        }}
                        className="flex shrink-0 items-center gap-1 rounded-full border border-[var(--color-line)] px-2 py-0.5 text-[10.5px] text-[var(--color-dim)]"
                      >
                        {copiedId === a.id ? <Check size={10} /> : <LinkIcon size={10} />}
                        {copiedId === a.id ? "Copied" : "Link"}
                      </button>
                    </div>
                  </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
        className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-3 py-3 md:px-5"
      >
        <div className="mx-auto w-full max-w-[760px] space-y-2">
          {thread && thread.messages.length === 0 && (
            <p className="py-8 text-center text-[12.5px] text-[var(--color-faint)]">
              No messages yet — say hi to your squad 👋
            </p>
          )}
          {(thread?.messages ?? []).map((m) => {
            const quoted = m.replyTo ? byId.get(m.replyTo) : null;
            return (
              <div key={m.id} className={`group flex ${m.mine ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-2xl border border-line px-3 py-1.5 md:max-w-[70%] ${
                    m.mine ? "rounded-br-sm bg-[rgba(146,166,255,0.10)]" : "rounded-bl-sm bg-[var(--color-tint-soft)]"
                  }`}
                >
                  {!m.mine && (
                    <button
                      type="button"
                      onClick={() => select(m.senderId)}
                      className="text-[10.5px] font-bold"
                      style={{ color: senderColor(m.senderId) }}
                    >
                      {m.senderLabel}
                    </button>
                  )}
                  {quoted && (
                    <div className="mb-1 mt-0.5 rounded-lg border-l-2 bg-[rgba(146,166,255,0.06)] px-2 py-1 text-[11px] text-[var(--color-dim)]" style={{ borderColor: senderColor(quoted.senderId) }}>
                      <span className="font-semibold" style={{ color: senderColor(quoted.senderId) }}>{quoted.senderLabel}</span>{" "}
                      {quoted.deleted ? "message deleted" : quoted.body.slice(0, 120)}
                    </div>
                  )}
                  {m.deleted ? (
                    <p className="text-[12px] italic text-[var(--color-faint)]">message deleted</p>
                  ) : (
                    <p dir="auto" className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-ink">{m.body}</p>
                  )}
                  {/* Actions stay VISIBLE (dimmed) — hover-only controls are
                      invisible on phones, which is where most sharing happens. */}
                  <div className="mt-1 flex items-center justify-end gap-2.5">
                    {!m.deleted && (
                      <button
                        type="button"
                        title={
                          answerIdOf.get(m.id)
                            ? "Saved as an answer — tap to share it"
                            : "Save as answer, then share (credited to the author)"
                        }
                        onClick={() => void share(m)}
                        disabled={sharing === m.id}
                        className="flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold transition disabled:opacity-50"
                        style={
                          answerIdOf.has(m.id)
                            ? { color: "var(--color-accent)", background: "var(--color-accent-soft)" }
                            : { color: "var(--color-faint)" }
                        }
                      >
                        {sharing === m.id ? (
                          <Loader2 size={11} className="animate-spin" />
                        ) : answerIdOf.has(m.id) ? (
                          <BookmarkCheck size={11} />
                        ) : (
                          <Bookmark size={11} />
                        )}
                        Share
                      </button>
                    )}
                    {!m.deleted && (
                      <button
                        type="button"
                        title="Reply"
                        onClick={() => setReplyTo(m)}
                        className="opacity-60 transition hover:opacity-100"
                      >
                        <CornerUpLeft size={11} className="text-[var(--color-faint)]" />
                      </button>
                    )}
                    {m.mine && !m.deleted && (
                      <button
                        type="button"
                        title="Delete"
                        onClick={() => void remove(m)}
                        className="opacity-60 transition hover:opacity-100"
                      >
                        <Trash2 size={11} className="text-[var(--color-faint)]" />
                      </button>
                    )}
                    <span className="text-[9.5px] text-[var(--color-faint)]">{timeOf(m.createdAt)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="shrink-0 px-2.5 pb-[max(env(safe-area-inset-bottom),10px)] pt-1 md:px-5 md:pb-4">
        <div className="mx-auto w-full max-w-[760px]">
          {replyTo && (
            <div className="mb-1 flex items-center gap-2 rounded-lg bg-[rgba(146,166,255,0.08)] px-2.5 py-1.5 text-[11.5px] text-[var(--color-dim)]">
              <CornerUpLeft size={12} />
              <span className="min-w-0 flex-1 truncate">
                Replying to <b style={{ color: senderColor(replyTo.senderId) }}>{replyTo.senderLabel}</b>: {replyTo.body.slice(0, 80)}
              </span>
              <button type="button" onClick={() => setReplyTo(null)} aria-label="Cancel reply">
                <X size={12} />
              </button>
            </div>
          )}
          <div className="flex items-end gap-2 rounded-2xl border border-[var(--color-line)] bg-[color-mix(in_srgb,var(--color-card)_92%,transparent)] p-2 backdrop-blur-md focus-within:border-[rgba(255,140,90,0.4)]">
            <textarea
              value={text}
              rows={1}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              dir="auto"
              placeholder="Message your group…"
              className="max-h-32 min-h-[38px] w-full resize-none bg-transparent px-1.5 py-1.5 text-[16px] leading-snug text-ink outline-none placeholder:text-[var(--color-faint)] md:text-[13.5px]"
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={sending || !text.trim()}
              aria-label="Send"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-space disabled:opacity-40"
              style={{ background: "var(--color-accent)" }}
            >
              {sending ? <Loader2 className="animate-spin" size={15} /> : <Send size={15} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Messages — group messaging rooms. Today that's your squad's chat; the same
 * surface hosts community groups when owners can create them. ?room=<id>
 * opens a thread; otherwise the room list.
 */
const CIRCLE_KINDS = [
  { id: "topic", label: "Topic", hint: "Around a subject — Residency, Accounting, Jobs…" },
  { id: "community", label: "Community", hint: "A group of people who belong together" },
  { id: "event", label: "Event", hint: "A one-off gathering or recurring meetup" },
  { id: "team", label: "Team", hint: "A working group — startup, project, crew" },
];

function CreateCircleSheet({ onClose, onCreated }: { onClose: () => void; onCreated: (roomId: string) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("topic");
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await createCircle({ name: name.trim(), description: description.trim(), category, open });
      onCreated(r.roomId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "couldn't create the circle");
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60]">
      <div className="absolute inset-0 bg-black/45" onClick={onClose} aria-hidden />
      <div className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-[20px] border border-line bg-[var(--color-card)] p-4 md:inset-x-auto md:left-1/2 md:top-1/2 md:bottom-auto md:w-[440px] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[13px] font-semibold text-ink" style={{ fontFamily: "var(--font-display)" }}>
            New circle
          </span>
          <button type="button" onClick={onClose} aria-label="Close">
            <X size={15} className="text-[var(--color-faint)]" />
          </button>
        </div>
        <input
          dir="auto"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name — e.g. Residency, Weekend hikes…"
          maxLength={60}
          className="mb-2 w-full rounded-xl border border-[var(--color-line)] bg-transparent px-3 py-2.5 text-[16px] text-ink outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-accent-line)] md:text-[13.5px]"
        />
        <textarea
          dir="auto"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What is this circle for? Shown to people deciding whether to join."
          rows={2}
          maxLength={280}
          className="mb-2 w-full resize-none rounded-xl border border-[var(--color-line)] bg-transparent px-3 py-2.5 text-[16px] leading-snug text-ink outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-accent-line)] md:text-[13.5px]"
        />
        <div className="mb-2 grid grid-cols-2 gap-1.5">
          {CIRCLE_KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              onClick={() => setCategory(k.id)}
              className="rounded-xl border px-3 py-2 text-left transition"
              style={
                category === k.id
                  ? { borderColor: "var(--color-accent-line)", background: "var(--color-accent-soft)" }
                  : { borderColor: "var(--color-line)" }
              }
            >
              <span className="block text-[12px] font-semibold text-ink">{k.label}</span>
              <span className="block text-[10px] leading-snug text-[var(--color-faint)]">{k.hint}</span>
            </button>
          ))}
        </div>
        <label className="mb-3 flex items-center gap-2 px-1 text-[12px] text-[var(--color-dim)]">
          <input type="checkbox" checked={open} onChange={(e) => setOpen(e.target.checked)} />
          Open — anyone in this space can join (uncheck: members add people)
        </label>
        {error && <p className="mb-2 text-[11.5px] text-[#fda4af]">{error}</p>}
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || !name.trim()}
          className="w-full rounded-xl py-2.5 text-[13px] font-bold text-space disabled:opacity-40"
          style={{ background: "var(--color-accent)" }}
        >
          {busy ? "Creating…" : "Create circle"}
        </button>
      </div>
    </div>
  );
}

export default function MessagesView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeRoom = searchParams.get("room");
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (activeRoom) return;
    let alive = true;
    const load = () =>
      fetchRooms()
        .then((r) => alive && setRooms(r.rooms))
        .catch(() => alive && setRooms([]));
    load();
    const t = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [activeRoom]);

  if (activeRoom) {
    return <Thread roomId={activeRoom} onBack={() => router.push("/messages")} />;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2.5 md:px-5">
        <MessagesSquare size={13} style={{ color: "var(--color-accent)" }} />
        <span className="text-[12.5px] font-semibold text-ink" style={{ fontFamily: "var(--font-display)" }}>
          Messages
        </span>
        <span className="text-[10.5px] text-[var(--color-faint)]">your squad & circles</span>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="ml-auto flex items-center gap-1 rounded-full border border-[var(--color-line)] px-2.5 py-1 text-[11.5px] font-semibold text-[var(--color-dim)] transition hover:border-[var(--color-accent-line)] hover:text-ink"
        >
          <Plus size={12} /> New circle
        </button>
      </div>
      {creating && (
        <CreateCircleSheet
          onClose={() => setCreating(false)}
          onCreated={(roomId) => {
            setCreating(false);
            router.push(`/messages?room=${encodeURIComponent(roomId)}`);
          }}
        />
      )}
      <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-3 py-3 md:px-5">
        <div className="mx-auto w-full max-w-[720px]">
          {rooms === null ? (
            <p className="py-6 text-center text-[12px] text-[var(--color-faint)]">Loading…</p>
          ) : rooms.length === 0 ? (
            <div className="py-10 text-center">
              <MessagesSquare size={24} className="mx-auto mb-2 text-[var(--color-faint)]" />
              <p className="text-[13px] text-[var(--color-dim)]">
                Join a squad or a circle and its group chat appears here — or start your own.
              </p>
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="mt-3 inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-[12.5px] font-bold text-space"
                style={{ background: "var(--color-accent)" }}
              >
                <Plus size={13} /> Create a circle
              </button>
              <button
                type="button"
                onClick={() => router.push("/")}
                className="mt-3 text-[12px] font-semibold"
                style={{ color: "var(--color-accent)" }}
              >
                Ask the agent: &ldquo;join squad 7&rdquo; →
              </button>
            </div>
          ) : (
            <ul className="space-y-1.5">
              {rooms.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => router.push(`/messages?room=${encodeURIComponent(r.id)}`)}
                    className="flex w-full items-center gap-3 rounded-xl border border-line bg-[var(--color-surface)] px-3.5 py-2.5 text-left backdrop-blur-md transition hover:border-[var(--color-accent-line)]"
                  >
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-[15px]" style={{ background: "rgba(146,166,255,0.12)" }}>
                      {r.kind === "circle" ? "\u2b55" : "👥"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-semibold text-ink">{r.title}</span>
                        <span className="text-[10px] text-[var(--color-faint)]">{r.memberCount} members</span>
                      </span>
                      <span className="mt-0.5 block truncate text-[11.5px] text-[var(--color-dim)]">
                        {r.lastMessage
                          ? `${r.lastMessage.senderLabel}: ${r.lastMessage.body.slice(0, 60)}`
                          : "No messages yet — say hi 👋"}
                      </span>
                    </span>
                    {r.unread > 0 && (
                      <span
                        className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full px-1.5 text-[10px] font-bold"
                        style={{ background: "var(--color-accent)", color: "var(--color-on-accent)" }}
                      >
                        {r.unread > 99 ? "99+" : r.unread}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
