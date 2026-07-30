"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, CornerUpLeft, Loader2, MessagesSquare, Send, Trash2, Users, X } from "lucide-react";
import { useUI } from "@/lib/store";
import {
  deleteRoomMessage,
  fetchRoomMessages,
  fetchRooms,
  markRoomRead,
  sendRoomMessage,
  type RoomMessage,
  type RoomSummary,
  type RoomThread,
} from "@/lib/socialClient";

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

function Thread({ roomId, onBack }: { roomId: string; onBack: () => void }) {
  const select = useUI((s) => s.select);
  const [thread, setThread] = useState<RoomThread | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState<RoomMessage | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);

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
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-ink" style={{ fontFamily: "var(--font-display)" }}>
            {thread?.room.title ?? "…"}
          </div>
          <div className="text-[10.5px] text-[var(--color-faint)]">
            {thread ? `${thread.members.length} members` : ""}
          </div>
        </div>
        <Users size={14} className="text-[var(--color-faint)]" />
      </div>

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
                    <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-ink">{m.body}</p>
                  )}
                  <div className="mt-0.5 flex items-center justify-end gap-2">
                    {!m.deleted && (
                      <button
                        type="button"
                        title="Reply"
                        onClick={() => setReplyTo(m)}
                        className="opacity-0 transition group-hover:opacity-100"
                      >
                        <CornerUpLeft size={11} className="text-[var(--color-faint)]" />
                      </button>
                    )}
                    {m.mine && !m.deleted && (
                      <button
                        type="button"
                        title="Delete"
                        onClick={() => void remove(m)}
                        className="opacity-0 transition group-hover:opacity-100"
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
              placeholder="Message your squad…"
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
export default function MessagesView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeRoom = searchParams.get("room");
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null);

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
        <span className="text-[10.5px] text-[var(--color-faint)]">your squad, and soon your groups</span>
      </div>
      <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-3 py-3 md:px-5">
        <div className="mx-auto w-full max-w-[720px]">
          {rooms === null ? (
            <p className="py-6 text-center text-[12px] text-[var(--color-faint)]">Loading…</p>
          ) : rooms.length === 0 ? (
            <div className="py-10 text-center">
              <MessagesSquare size={24} className="mx-auto mb-2 text-[var(--color-faint)]" />
              <p className="text-[13px] text-[var(--color-dim)]">
                Join a squad and its group chat appears here.
              </p>
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
                      👥
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
