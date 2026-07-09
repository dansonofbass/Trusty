"use client";

import { ExternalLink } from "lucide-react";
import type { ExtractedEntity, NodeType } from "@constellation/graph-core";
import { NODE_COLOR } from "@/lib/palette";

const KIND_TO_NODE: Partial<Record<ExtractedEntity["kind"], NodeType>> = {
  person: "person",
  book: "book",
  movie: "movie",
  music: "music",
  location: "location",
};

const KIND_LABEL: Record<ExtractedEntity["kind"], string> = {
  concept: "Concept",
  person: "Person",
  book: "Book",
  movie: "Film",
  music: "Music",
  location: "Place",
  organization: "Org",
  technology: "Tech",
  event: "Event",
  work: "Work",
  // Trusty Sevan meeting-note kinds (surface here if a summit extraction is shown):
  need: "Need",
  api: "API",
  skill: "Skill",
  idea: "Idea",
  market: "Market",
  startup: "Startup",
  investor: "Investor",
  mentor: "Mentor",
  country: "Country",
};

export default function EntityCard({
  entity,
  index,
  active,
  onHover,
  animateDelay = 0,
}: {
  entity: ExtractedEntity;
  index: number;
  active?: boolean;
  onHover?: (index: number | null) => void;
  animateDelay?: number;
}) {
  const source = entity.sources?.[0];
  const nodeType = KIND_TO_NODE[entity.kind] ?? "concept";
  const tint = NODE_COLOR[nodeType];

  return (
    <article
      className={`flex gap-3 rounded-xl border p-3 transition ${animateDelay > 0 ? "entity-card-in" : ""}`}
      style={{
        borderColor: active ? `${tint}66` : "var(--color-line)",
        background: active ? `${tint}12` : "rgba(146,166,255,0.04)",
        boxShadow: active ? `0 0 0 1px ${tint}33` : undefined,
        animationDelay: animateDelay > 0 ? `${animateDelay}ms` : undefined,
      }}
      onMouseEnter={() => onHover?.(index)}
      onMouseLeave={() => onHover?.(null)}
    >
      <div
        className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border"
        style={{
          borderColor: `${tint}44`,
          background: `${tint}18`,
        }}
      >
        {source?.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={source.imageUrl}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center text-[18px] font-semibold"
            style={{ color: tint }}
          >
            {entity.name[0]?.toUpperCase() ?? "?"}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="break-words text-[13px] font-semibold leading-snug text-ink">
            {entity.name}
          </h3>
          <span
            className="shrink-0 rounded-md px-1.5 py-0.5 text-[9.5px] uppercase tracking-wide"
            style={{
              color: tint,
              background: `${tint}18`,
              fontFamily: "var(--font-mono)",
            }}
          >
            {KIND_LABEL[entity.kind]}
          </span>
        </div>
        {typeof entity.salience === "number" && (
          <div className="mt-1.5 flex items-center gap-2">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-[rgba(146,166,255,0.12)]">
              <div
                className="h-full rounded-full"
                style={{ width: `${Math.round(entity.salience * 100)}%`, background: tint }}
              />
            </div>
            <span className="text-[10px] text-[var(--color-faint)]" style={{ fontFamily: "var(--font-mono)" }}>
              {Math.round(entity.salience * 100)}%
            </span>
          </div>
        )}
        {source && (
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-[11px] text-[var(--color-accent,#7c96ff)] hover:underline"
          >
            <ExternalLink size={11} />
            Wikipedia · {source.title}
          </a>
        )}
      </div>
    </article>
  );
}
