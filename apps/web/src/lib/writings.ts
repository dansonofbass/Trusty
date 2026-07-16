import type { ThoughtExtraction } from "@constellation/graph-core";

/** A row in the user's private workspace (Postgres, via the BFF). */
export interface WritingSummary {
  id: string;
  thought_id: string | null;
  title: string | null;
  snippet?: string | null;
  status: string;
  kind?: string;
  collections?: string[];
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
  kind?: string;
  collections?: string[];
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

export interface WorkspaceList {
  writings: WritingSummary[];
  collections: string[];
}

/** The viewer's private workspace — searchable and filterable (#31). */
export async function fetchWorkspace(opts: { q?: string; kind?: string; collection?: string } = {}): Promise<WorkspaceList> {
  try {
    const p = new URLSearchParams();
    if (opts.q) p.set("q", opts.q);
    if (opts.kind) p.set("kind", opts.kind);
    if (opts.collection) p.set("collection", opts.collection);
    const qs = p.toString();
    const r = await fetch(`/api/writings${qs ? `?${qs}` : ""}`, { cache: "no-store" });
    if (!r.ok) return { writings: [], collections: [] };
    return (await r.json()) as WorkspaceList;
  } catch {
    return { writings: [], collections: [] };
  }
}

export async function fetchWritings(): Promise<WritingSummary[]> {
  return (await fetchWorkspace()).writings;
}

/** Edit a doc — the previous body is preserved as a version server-side. */
export async function updateWorkspaceDoc(
  id: string,
  patch: { title?: string; body?: string; kind?: string; collections?: string[]; status?: "draft" | "published" },
): Promise<boolean> {
  try {
    const r = await fetch(`/api/writings/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function deleteWorkspaceDoc(id: string): Promise<boolean> {
  try {
    const r = await fetch(`/api/writings/${encodeURIComponent(id)}`, { method: "DELETE" });
    return r.ok;
  } catch {
    return false;
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
