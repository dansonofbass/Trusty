"use client";

import type { ReactNode } from "react";
import type { ExtractedEntity, NodeType } from "@constellation/graph-core";
import { findEntitySpans } from "@/lib/entitySpans";
import { NODE_COLOR } from "@/lib/palette";

const KIND_TO_NODE: Partial<Record<ExtractedEntity["kind"], NodeType>> = {
  person: "person",
  book: "book",
  movie: "movie",
  music: "music",
  location: "location",
};

function tintFor(entity: ExtractedEntity) {
  const nodeType = KIND_TO_NODE[entity.kind] ?? "concept";
  return NODE_COLOR[nodeType];
}

export default function AnnotatedText({
  text,
  entities,
  activeIndex,
  onHoverEntity,
  animate,
  compact,
}: {
  text: string;
  entities: ExtractedEntity[];
  activeIndex?: number | null;
  onHoverEntity?: (index: number | null) => void;
  /** Stagger highlight entrance (Write review / thought inspector). */
  animate?: boolean;
  compact?: boolean;
}) {
  const spans = findEntitySpans(text, entities);
  const textClass = compact
    ? "text-[12px] leading-[1.65]"
    : "text-[13px] leading-[1.75]";

  if (spans.length === 0) {
    return (
      <p className={`whitespace-pre-wrap ${textClass} text-[var(--color-dim)]`}>{text}</p>
    );
  }

  const parts: ReactNode[] = [];
  let cursor = 0;

  spans.forEach((span, i) => {
    if (span.start > cursor) {
      parts.push(<span key={`t-${i}`}>{text.slice(cursor, span.start)}</span>);
    }
    const entity = entities[span.entityIndex];
    const active = activeIndex === span.entityIndex;
    const tint = tintFor(entity);
    parts.push(
      <mark
        key={`m-${i}`}
        className={`cursor-default rounded-sm px-0.5 transition ${animate ? "entity-highlight" : ""}`}
        style={{
          background: active ? `${tint}55` : `${tint}28`,
          color: "var(--color-ink)",
          boxShadow: active ? `inset 0 -2px 0 ${tint}, 0 0 12px ${tint}33` : undefined,
          animationDelay: animate ? `${120 + i * 90}ms` : undefined,
        }}
        onMouseEnter={() => onHoverEntity?.(span.entityIndex)}
        onMouseLeave={() => onHoverEntity?.(null)}
        title={entity.name}
      >
        {text.slice(span.start, span.end)}
      </mark>,
    );
    cursor = span.end;
  });

  if (cursor < text.length) parts.push(<span key="tail">{text.slice(cursor)}</span>);

  return (
    <p className={`whitespace-pre-wrap ${textClass} text-ink`}>{parts}</p>
  );
}
