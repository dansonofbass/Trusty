"use client";

import { useEffect, useState } from "react";
import { BadgeCheck, Loader2 } from "lucide-react";
import SpecialistAvatar from "@/components/specialist/SpecialistAvatar";
import {
  fetchSpecialistsByTopics,
  SPECIALIST_TYPE_FA,
  TRUST_LABEL_FA,
  type SpecialistCard,
} from "@/lib/specialistClient";
import { useI18n, useT } from "@/lib/i18n";

/**
 * Experts — the trust-ranked specialists for this community's professions.
 *
 * This used to be a panel that expanded inside the old button-wall front door.
 * With the front door rebuilt around topics it gets its own route instead:
 * "who can I actually pay to solve this" is a different job from "has someone
 * already answered this", and cramming both onto one screen served neither.
 */

/** Professions relevant to relocating to Armenia — the topics irham's own
 *  circles are tagged with (see infra/fixtures/circles-iran.json). */
const EXPERT_TOPICS = ["immigration", "accountant", "broker", "real_estate", "doctor", "dentist"];

export default function ExpertsPage() {
  const t = useT();
  const { locale } = useI18n();
  const [experts, setExperts] = useState<SpecialistCard[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetchSpecialistsByTopics(EXPERT_TOPICS)
      .then((r) => alive && setExperts(r))
      .catch(() => alive && setExperts([]));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="scroll-quiet h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[760px] px-4 py-5">
        <header className="mb-4">
          <h1 className="text-[20px] font-extrabold text-ink" style={{ fontFamily: "var(--font-display)" }}>
            {t("community.experts")}
          </h1>
          <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--color-dim)]">{t("community.expertsIntro")}</p>
        </header>

        {!experts ? (
          <div className="grid place-items-center py-16 text-[var(--color-dim)]">
            <Loader2 className="animate-spin" size={20} />
          </div>
        ) : experts.length === 0 ? (
          <p className="py-16 text-center text-[13px] text-[var(--color-faint)]">{t("community.expertsEmpty")}</p>
        ) : (
          <ul className="space-y-2">
            {experts.map((e) => (
              <li
                key={e.nodeId}
                className="flex items-center gap-3 rounded-2xl border border-line bg-[var(--color-surface)] p-3 backdrop-blur-md transition hover:border-[var(--color-accent-line)]"
              >
                <SpecialistAvatar label={e.label} photoUrl={e.photoUrl} size={38} rounded="rounded-xl" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span dir="auto" className="truncate text-[14px] font-bold text-ink">{e.label}</span>
                    {e.verified && <BadgeCheck size={13} style={{ color: "var(--color-accent)" }} />}
                  </span>
                  <span className="mt-0.5 block text-[11.5px] text-[var(--color-dim)]">
                    {(locale === "fa" ? SPECIALIST_TYPE_FA[e.nodeType] : undefined) ?? e.nodeType} ·{" "}
                    {(locale === "fa" ? TRUST_LABEL_FA[e.trustLabel] : undefined) ?? e.trustLabelText}
                  </span>
                </span>
                {/* Always the in-app profile — never a direct t.me link. Contact
                    details sit behind the trust evidence so nobody DMs a
                    stranger without seeing what backs them. */}
                <a
                  href={`/s/${encodeURIComponent(e.nodeId)}`}
                  className="shrink-0 rounded-full px-3.5 py-1.5 text-[12px] font-bold"
                  style={{ background: "var(--color-accent)", color: "var(--color-on-accent)" }}
                >
                  {t("expert.viewProfile")}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
