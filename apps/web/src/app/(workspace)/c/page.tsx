"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CircleDot, Loader2, MessageSquare, Users } from "lucide-react";
import { fetchCircles, joinCircle, type CircleSummary } from "@/lib/socialClient";
import { useT, type TranslationKey } from "@/lib/i18n";

/**
 * Circles index — the platform's front door.
 *
 * Circles are where the knowledge lives, so this is the first thing a member
 * sees rather than something buried under Discover. Joining from here goes
 * straight into the forum.
 */

const CATEGORY_KEY: Record<string, TranslationKey> = {
  topic: "circle.kindTopic",
  community: "circle.kindCommunity",
  event: "circle.kindEvent",
  team: "circle.kindTeam",
};

export default function CirclesIndexPage() {
  const t = useT();
  const router = useRouter();
  const [circles, setCircles] = useState<CircleSummary[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchCircles()
      .then((r) => alive && setCircles(r.circles))
      .catch(() => alive && setCircles([]));
    return () => {
      alive = false;
    };
  }, []);

  const enter = async (c: CircleSummary) => {
    if (c.mine) return router.push(`/c/${encodeURIComponent(c.id)}`);
    setBusyId(c.id);
    try {
      await joinCircle(c.id);
      router.push(`/c/${encodeURIComponent(c.id)}`);
    } catch {
      setBusyId(null);
    }
  };

  return (
    <div className="scroll-quiet h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[760px] px-4 py-5">
        <header className="mb-4 flex items-center gap-2">
          <CircleDot size={17} style={{ color: "var(--color-accent)" }} />
          <h1 className="text-[20px] font-extrabold text-ink" style={{ fontFamily: "var(--font-display)" }}>
            {t("community.circles")}
          </h1>
        </header>

        {circles === null ? (
          <div className="grid place-items-center py-16 text-[var(--color-dim)]">
            <Loader2 className="animate-spin" size={20} />
          </div>
        ) : circles.length === 0 ? (
          <p className="py-16 text-center text-[13px] text-[var(--color-faint)]">{t("community.circlesEmpty")}</p>
        ) : (
          <ul className="space-y-2">
            {circles.map((c) => (
              <li
                key={c.id}
                className="flex items-center gap-3 rounded-2xl border border-line bg-[var(--color-surface)] p-3.5 backdrop-blur-md transition hover:border-[var(--color-accent-line)]"
              >
                <span className="min-w-0 flex-1">
                  <Link href={`/c/${encodeURIComponent(c.id)}`} className="block">
                    <span className="flex flex-wrap items-center gap-2">
                      <span dir="auto" className="truncate text-[14px] font-bold text-ink">{c.label}</span>
                      <span className="rounded-full bg-[var(--color-tint)] px-1.5 py-0.5 text-[10px] text-[var(--color-dim)]">
                        {t(CATEGORY_KEY[c.category] ?? "circle.kindTopic")}
                      </span>
                    </span>
                    {c.description && (
                      <span dir="auto" className="mt-0.5 line-clamp-2 block text-[12px] leading-relaxed text-[var(--color-dim)]">
                        {c.description}
                      </span>
                    )}
                  </Link>
                  <span className="mt-1 flex items-center gap-2 text-[11px] text-[var(--color-faint)]">
                    <Users size={11} /> {t("circle.memberCount", { count: c.memberCount })}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={busyId === c.id || (!c.open && !c.mine)}
                  onClick={() => void enter(c)}
                  className="flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-bold transition disabled:opacity-40"
                  style={
                    c.mine
                      ? { background: "rgba(146,166,255,0.12)", color: "var(--color-ink)" }
                      : { background: "var(--color-accent)", color: "var(--color-on-accent)" }
                  }
                >
                  {c.mine ? (
                    <>
                      <MessageSquare size={12} /> {t("circle.open_")}
                    </>
                  ) : c.open ? (
                    busyId === c.id ? t("circle.joining") : t("circle.join")
                  ) : (
                    t("circle.inviteOnly")
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
