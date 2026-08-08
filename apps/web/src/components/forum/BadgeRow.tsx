"use client";

import { BadgeCheck, ShieldCheck, Star } from "lucide-react";
import { useT, type TranslationKey } from "@/lib/i18n";
import { SPECIALIST_TYPE_FA } from "@/lib/specialistClient";
import type { Badge } from "@/lib/forumClient";

/**
 * The badges next to an author's name. `kind` keys come from ONE server-side
 * resolver, so what counts as a moderator or a verified specialist can't drift
 * between the thread, the sidebar and the profile.
 */

const STYLE: Record<string, { icon?: typeof BadgeCheck; bg: string; fg: string }> = {
  owner: { icon: ShieldCheck, bg: "rgba(255,140,90,0.14)", fg: "var(--color-accent)" },
  moderator: { icon: ShieldCheck, bg: "rgba(146,166,255,0.14)", fg: "#92a6ff" },
  verified_specialist: { icon: BadgeCheck, bg: "rgba(84,210,110,0.14)", fg: "#54d26e" },
  specialist: { icon: BadgeCheck, bg: "rgba(255,255,255,0.06)", fg: "var(--color-dim)" },
};

export default function BadgeRow({
  badges,
  karma,
  locale,
}: {
  badges: Badge[];
  karma?: number;
  /** Profession names are only translated for Persian readers. */
  locale?: string;
}) {
  const t = useT();
  if (badges.length === 0 && !karma) return null;

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {badges.map((b) => {
        if (b.kind === "profession") {
          const label = locale === "fa" ? SPECIALIST_TYPE_FA[b.value ?? ""] ?? b.value : b.value?.replace(/_/g, " ");
          return (
            <span key="profession" className="rounded-full border border-line px-1.5 py-0.5 text-[10px] capitalize text-[var(--color-faint)]">
              {label}
            </span>
          );
        }
        const s = STYLE[b.kind];
        if (!s) return null;
        const Icon = s.icon;
        return (
          <span
            key={b.kind}
            className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
            style={{ background: s.bg, color: s.fg }}
          >
            {Icon && <Icon size={9} />}
            {t(`badge.${b.kind}` as TranslationKey)}
          </span>
        );
      })}
      {!!karma && karma > 0 && (
        <span className="inline-flex items-center gap-0.5 text-[10px] text-[var(--color-faint)]">
          <Star size={9} /> {t("forum.karma", { count: karma })}
        </span>
      )}
    </span>
  );
}
