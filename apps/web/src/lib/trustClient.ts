/**
 * Trust client — talks to the same-origin BFF trust routes (which proxy to the
 * internal graph-service / extractor). Powers Trust Search, the explicit Trust
 * action, and outcome feedback.
 */
import type { GLink, Recommendation, TrustScope } from "@constellation/graph-core";

/** A trust the AI proposed from writing; the user confirms before it's written. */
export interface TrustAssertion {
  object: string;
  object_kind?: string;
  scope: TrustScope;
  reasons: string[];
  confidence: number;
}

export interface ResolvedScope extends TrustScope {
  variant?: string;
}

/** A trust-search result: a Recommendation enriched with display context. */
export interface TrustRec extends Recommendation {
  label: string;
  nodeType?: string;
  sub?: string;
  /** Ontology class + typed properties (cuisine/price/geo…) for place cards. */
  entityType?: string;
  properties?: Record<string, unknown>;
  lat?: number;
  lng?: number;
  /** Distance from the viewer in km, when "near me" coords were sent. */
  distanceKm?: number;
  viaLabels: string[];
  /** Hop count to the result (1 = you trust them directly). */
  hops: number;
  /** Reason codes on the terminal trust edge. */
  reasons: string[];
  /** Labelled path: ["You", …intermediaries, target]. */
  pathLabels: string[];
}

async function jsonOrThrow(r: Response) {
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error((body as { error?: string })?.error ?? `request failed (${r.status})`);
  return body;
}

/** Search people & entities in the (general) app directory by free text. */
export async function searchDirectory(q: string): Promise<import("@constellation/graph-core").GNode[]> {
  const p = new URLSearchParams();
  if (q.trim()) p.set("q", q.trim());
  const r = await fetch(`/api/directory?${p}`, { cache: "no-store" });
  const b = (await jsonOrThrow(r)) as { nodes: import("@constellation/graph-core").GNode[] };
  return b.nodes ?? [];
}

/** Resolve a natural-language query into a structured trust scope. */
export async function resolveScope(q: string): Promise<ResolvedScope> {
  const r = await fetch("/api/resolve-scope", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ q }),
  });
  return (await jsonOrThrow(r)) as ResolvedScope;
}

/** Trust-ranked search for a scope → recommendations carrying their trust path.
 *  Optional `lat`/`lng`/`radiusKm` annotate results with distance ("near me"). */
export async function trustSearch(
  scope: { topic: string; geo?: string; context?: string; lat?: number; lng?: number; radiusKm?: number },
): Promise<{ query: TrustScope; recommendations: TrustRec[] }> {
  const r = await fetch("/api/trust/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(scope),
  });
  return (await jsonOrThrow(r)) as { query: TrustScope; recommendations: TrustRec[] };
}

/** Create/update a trust edge: the viewer trusts `to` on a topic scope. */
export async function addTrust(input: {
  to: string;
  scope: TrustScope;
  reasons?: string[];
  confidence?: number;
  /** Free-text note ("great for date night") — the trust-native short review. */
  note?: string;
}): Promise<unknown> {
  const r = await fetch("/api/trust", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return jsonOrThrow(r);
}

export async function removeTrust(linkId: string): Promise<unknown> {
  const r = await fetch("/api/trust", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ linkId }),
  });
  return jsonOrThrow(r);
}

/** The viewer's own trust edges. */
export async function listTrust(): Promise<GLink[]> {
  const r = await fetch("/api/trust", { cache: "no-store" });
  return (await jsonOrThrow(r)) as GLink[];
}

/** Record outcome feedback on a trust edge (👍 → +1, 👎 → -1). */
export async function recordOutcome(edgeId: string, value: number, recNodeId?: string): Promise<unknown> {
  const r = await fetch("/api/trust/outcome", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ edgeId, value, recNodeId, kind: value >= 0 ? "positive" : "negative" }),
  });
  return jsonOrThrow(r);
}
