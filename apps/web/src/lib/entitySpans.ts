import type { ExtractedEntity } from "@constellation/graph-core";

export interface EntitySpan {
  start: number;
  end: number;
  entityIndex: number;
}

/** Find non-overlapping mention spans in the original text for highlighting. */
export function findEntitySpans(text: string, entities: ExtractedEntity[]): EntitySpan[] {
  const lower = text.toLowerCase();
  const used: Array<[number, number]> = [];
  const spans: EntitySpan[] = [];

  const overlaps = (start: number, end: number) =>
    used.some(([s, e]) => start < e && end > s);

  entities.forEach((entity, entityIndex) => {
    const needles = [entity.mention, entity.name].filter(
      (n): n is string => typeof n === "string" && n.trim().length > 1,
    );
    for (const needle of needles) {
      const q = needle.trim();
      const idx = lower.indexOf(q.toLowerCase());
      if (idx < 0) continue;
      const end = idx + q.length;
      if (overlaps(idx, end)) continue;
      used.push([idx, end]);
      spans.push({ start: idx, end, entityIndex });
      break;
    }
  });

  return spans.sort((a, b) => a.start - b.start);
}
