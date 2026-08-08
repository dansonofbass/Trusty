"use client";

import Link from "next/link";
import { Users } from "lucide-react";
import SpecialistAvatar from "@/components/specialist/SpecialistAvatar";
import BadgeRow from "./BadgeRow";
import { SPECIALIST_TYPE_FA, TRUST_LABEL_FA } from "@/lib/specialistClient";
import { useI18n } from "@/lib/i18n";
import type { CircleAbout } from "@/lib/forumClient";

/**
 * Reddit-style sidebar: what this circle is, who runs it, who to ask.
 *
 * Specialist entries link to the in-app profile — never straight to Telegram.
 * Contact details live on the profile, behind the trust evidence, so nobody
 * DMs a stranger without first seeing what backs them.
 */
export default function CircleSidebar({ about }: { about: CircleAbout }) {
  const { t, locale } = useI18n();
  const fa = locale === "fa";

  return (
    <aside className="space-y-3">
      <section className="rounded-2xl border border-line bg-[var(--color-surface)] p-4 backdrop-blur-md">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-faint)]">
          {t("forum.about")}
        </h2>
        {about.description && (
          <p dir="auto" className="mt-2 text-[12.5px] leading-relaxed text-[var(--color-dim)]">
            {about.description}
          </p>
        )}
        <div className="mt-2 flex items-center gap-1.5 text-[11.5px] text-[var(--color-faint)]">
          <Users size={12} /> {t("forum.members", { count: about.memberCount })}
        </div>
      </section>

      {about.mentors.length > 0 && (
        <section className="rounded-2xl border border-line bg-[var(--color-surface)] p-4 backdrop-blur-md">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-faint)]">
            {t("community.experts")}
          </h2>
          <ul className="mt-2 space-y-2">
            {about.mentors.map((m) => (
              <li key={m.nodeId}>
                <Link
                  href={`/s/${encodeURIComponent(m.nodeId)}`}
                  className="flex items-center gap-2 rounded-xl px-1 py-1 transition hover:bg-[var(--color-tint)]"
                >
                  <SpecialistAvatar label={m.label} photoUrl={m.photoUrl} size={28} rounded="rounded-lg" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-semibold text-ink">{m.label}</span>
                    <span className="block text-[10.5px] text-[var(--color-dim)]">
                      {fa ? SPECIALIST_TYPE_FA[m.nodeType] ?? m.nodeType : m.nodeType.replace(/_/g, " ")} ·{" "}
                      {fa ? TRUST_LABEL_FA[m.trustLabel] ?? m.trustLabelText : m.trustLabelText}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {about.moderators.length > 0 && (
        <section className="rounded-2xl border border-line bg-[var(--color-surface)] p-4 backdrop-blur-md">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-faint)]">
            {t("forum.moderators")}
          </h2>
          <ul className="mt-2 space-y-1.5">
            {about.moderators.map((m) => (
              <li key={m.id} className="flex items-center gap-2">
                <SpecialistAvatar label={m.label ?? m.id} photoUrl={m.photoUrl} size={22} rounded="rounded-full" />
                <span className="min-w-0 flex-1 truncate text-[12px] text-ink">{m.label ?? m.id}</span>
                <BadgeRow badges={m.badges ?? []} locale={locale} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {about.contributors.length > 0 && (
        <section className="rounded-2xl border border-line bg-[var(--color-surface)] p-4 backdrop-blur-md">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-faint)]">
            {t("forum.contributors")}
          </h2>
          <ul className="mt-2 space-y-1.5">
            {about.contributors.slice(0, 8).map((c) => (
              <li key={c.id} className="flex items-center gap-2">
                <SpecialistAvatar label={c.label} photoUrl={c.photoUrl} size={22} rounded="rounded-full" />
                <span className="min-w-0 flex-1 truncate text-[12px] text-ink">{c.label}</span>
                <BadgeRow badges={c.badges} karma={c.karma} locale={locale} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}
