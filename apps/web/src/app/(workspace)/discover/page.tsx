"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MessagesSquare, Radio, Users } from "lucide-react";
import { FeedContent } from "@/components/FeedPanel";
import { useUI } from "@/lib/store";
import { fetchSquadActivity, type SquadActivity } from "@/lib/socialClient";

function timeAgo(iso: string): string {
  const s = Math.max(1, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** What's happening across squads: chat volume + who just joined. */
function SquadActivitySection() {
  const router = useRouter();
  const select = useUI((s) => s.select);
  const [activity, setActivity] = useState<SquadActivity | null>(null);

  useEffect(() => {
    let alive = true;
    fetchSquadActivity()
      .then((a) => alive && setActivity(a))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (!activity || (activity.chatter.length === 0 && activity.joins.length === 0)) return null;

  return (
    <section className="mb-5">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-faint)]">
        <Users size={11} /> Squad activity
      </div>
      {activity.chatter.length > 0 && (
        <div className="mb-2 space-y-1.5">
          {activity.chatter.slice(0, 4).map((c) => (
            <button
              key={c.squadId}
              type="button"
              onClick={() => router.push("/messages")}
              className="flex w-full items-center gap-3 rounded-xl border border-line bg-[var(--color-surface)] px-3.5 py-2.5 text-left backdrop-blur-md transition hover:border-[var(--color-accent-line)]"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ background: "rgba(146,166,255,0.12)" }}>
                <MessagesSquare size={15} style={{ color: "var(--color-accent)" }} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold text-ink">{c.squad}</span>
                <span className="block text-[11px] text-[var(--color-dim)]">
                  {c.messages24h > 0
                    ? `${c.messages24h} message${c.messages24h === 1 ? "" : "s"} today`
                    : `last message ${timeAgo(c.lastAt)}`}{" "}
                  · {c.memberCount} members
                </span>
              </span>
              <span className="text-[11px] font-semibold" style={{ color: "var(--color-accent)" }}>
                Open chat →
              </span>
            </button>
          ))}
        </div>
      )}
      {activity.joins.length > 0 && (
        <ul className="space-y-0.5">
          {activity.joins.slice(0, 6).map((j, i) => (
            <li key={`${j.memberId}_${i}`}>
              <button
                type="button"
                onClick={() => select(j.memberId)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[11.5px] text-[var(--color-dim)] transition hover:bg-[var(--color-tint)] hover:text-ink"
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "var(--color-accent)" }} />
                <span className="min-w-0 flex-1 truncate">
                  <b className="text-ink">{j.member}</b> joined {j.squad}
                </span>
                <span className="shrink-0 text-[10px] text-[var(--color-faint)]">{timeAgo(j.at)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Discover — recommendations from the people you listen to, as a center
 * view. The old feed↔graph live-highlight dual view retired with the shell;
 * each card's ⌖ jumps to /graph centered on the node instead.
 */
export default function DiscoverPage() {
  const router = useRouter();
  const select = useUI((s) => s.select);
  const requestGraphCenter = useUI((s) => s.requestGraphCenter);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line px-5 py-2.5">
        <Radio size={13} style={{ color: "var(--color-accent)" }} />
        <span className="text-[12.5px] font-semibold text-ink" style={{ fontFamily: "var(--font-display)" }}>
          Discover
        </span>
        <span className="text-[10.5px] text-[var(--color-faint)]">
          recommendations from people you listen to
        </span>
      </div>
      <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[720px] px-4 py-4">
          <SquadActivitySection />
          <FeedContent
            selected={null}
            onJump={(id) => {
              select(id);
              requestGraphCenter(id);
              router.push("/graph");
            }}
          />
        </div>
      </div>
    </div>
  );
}
