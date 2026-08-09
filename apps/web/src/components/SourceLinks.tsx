"use client";

import { ExternalLink } from "lucide-react";
import type { EntitySource } from "@constellation/graph-core";
import { useT } from "@/lib/i18n";

export default function SourceLinks({ sources }: { sources: EntitySource[] }) {
  const t = useT();
  if (!sources.length) return null;

  return (
    <div className="mt-3 flex flex-col gap-2">
      <div className="eyebrow text-[var(--color-faint)]">{t("common.sources")}</div>
      {sources.map((s) => (
        <a
          key={s.url}
          href={s.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2.5 rounded-xl border border-[var(--color-line)] bg-[rgba(146,166,255,0.04)] p-2 transition hover:border-[rgba(124,150,255,0.35)]"
        >
          <div className="h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-[rgba(146,166,255,0.08)]">
            {s.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={s.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-[11px] text-[var(--color-faint)]">
                Wiki
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-medium text-ink">{s.title}</div>
            <div className="mt-0.5 flex items-center gap-1 text-[10.5px] text-[var(--color-accent,#7c96ff)]">
              <ExternalLink size={10} />
              {s.provider === "wikipedia" ? "Wikipedia" : s.provider}
              {s.lang ? ` · ${s.lang}` : ""}
            </div>
          </div>
        </a>
      ))}
    </div>
  );
}
