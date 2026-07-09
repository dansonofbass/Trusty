import type { ThoughtExtraction } from "@constellation/graph-core";

/** A row in the user's writings log (Postgres, via the BFF). */
export interface WritingSummary {
  id: string;
  thought_id: string | null;
  title: string | null;
  status: string;
  summary: string | null;
  created_at: string;
  updated_at: string;
}

export interface WritingEvent {
  kind: string;
  detail: Record<string, unknown> | null;
  at: string;
}

export interface WritingDetail {
  id: string;
  thought_id: string | null;
  title: string | null;
  body: string;
  extraction: ThoughtExtraction | null;
  status: string;
  created_at: string;
  updated_at: string;
  events: WritingEvent[];
}

/** Save/update a draft (best-effort; fire-and-forget). */
export async function saveDraft(d: {
  id: string;
  title?: string | null;
  body: string;
  extraction: ThoughtExtraction;
}): Promise<void> {
  try {
    await fetch("/api/writings/draft", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(d),
    });
  } catch {
    /* best-effort */
  }
}

export async function fetchWritings(): Promise<WritingSummary[]> {
  try {
    const r = await fetch("/api/writings", { cache: "no-store" });
    return r.ok ? ((await r.json()) as WritingSummary[]) : [];
  } catch {
    return [];
  }
}

export async function fetchWriting(id: string): Promise<WritingDetail | null> {
  try {
    const r = await fetch(`/api/writings/${encodeURIComponent(id)}`, { cache: "no-store" });
    return r.ok ? ((await r.json()) as WritingDetail) : null;
  } catch {
    return null;
  }
}
