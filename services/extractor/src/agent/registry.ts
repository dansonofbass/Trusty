/**
 * Composer agent tools — thin, identity-carrying fetches to graph-service.
 *
 * Every executor calls graph-service with `x-user-id: ctx.userId` (the BFF-
 * verified viewer), so the agent can never act as anyone else. Outward-facing
 * tools (`confirm: true`) are never executed directly by the loop — the UI
 * shows a confirm card first and the loop resumes with the user's decision.
 *
 * Summaries are what the model reads; `data` is the rich payload the UI renders
 * (e.g. trust recommendations → the orange graph overlay).
 */
import { TOPIC_TAXONOMY, normalizeTopic } from "@constellation/graph-core";
import type { AgentTool, ToolContext, ToolOutcome, ToolRegistry } from "./loop";

const TOPIC_LIST = TOPIC_TAXONOMY.join(", ");

const str = (v: unknown, max = 500): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;

const strArr = (v: unknown, max = 10): string[] | undefined =>
  Array.isArray(v)
    ? (v.filter((x): x is string => typeof x === "string").slice(0, max) as string[])
    : undefined;

/** POST/GET graph-service as the viewer; JSON in/out with a compact error. */
async function graphFetch(
  ctx: ToolContext,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const r = await fetch(`${ctx.graphUrl}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      "content-type": "application/json",
      "x-user-id": ctx.userId,
    },
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    signal: ctx.signal,
  });
  const body = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, body };
}

const fail = (body: unknown, status: number): ToolOutcome => ({
  ok: false,
  summary:
    (body as { error?: string } | null)?.error ?? `graph-service responded ${status}`,
});

/** Validate a topic against the taxonomy; returns the canonical topic or null. */
function canonicalTopic(v: unknown): string | null {
  const raw = str(v, 60);
  if (!raw) return null;
  const norm = normalizeTopic(raw.toLowerCase().replace(/\s+/g, "_"));
  return TOPIC_TAXONOMY.includes(norm) ? norm : null;
}

const topicError = (v: unknown): ToolOutcome => ({
  ok: false,
  summary: `"${String(v)}" is not a known topic. Use exactly one of: ${TOPIC_LIST}.`,
});

interface TrustRecLite {
  nodeId: string;
  label: string;
  nodeType?: string;
  score: number;
  hops: number;
  reasons: string[];
  pathLabels: string[];
}

/* ------------------------------- tools ------------------------------- */

const trustSearch: AgentTool = {
  name: "trust_search",
  description:
    `Search who the user's network trusts for a topic. Call this FIRST whenever the user is looking for a provider, place or person (dentist, lawyer, restaurant, …). Topic MUST be one of: ${TOPIC_LIST}. Results carry real trust paths — cite them by name.`,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      topic: { type: "string", description: `One of: ${TOPIC_LIST}` },
      geo: { type: "string", description: "City/area, lowercase, only if the user named one" },
      context: { type: "string", description: "Use-case like date_night, only if clear" },
    },
    required: ["topic"],
  },
  async execute(input, ctx) {
    const args = (input ?? {}) as Record<string, unknown>;
    const topic = canonicalTopic(args.topic);
    if (!topic) return topicError(args.topic);
    const r = await graphFetch(ctx, "/api/trust-search", {
      method: "POST",
      body: { topic, geo: str(args.geo, 80), context: str(args.context, 80) },
    });
    if (!r.ok) return fail(r.body, r.status);
    const recs = ((r.body as { recommendations?: TrustRecLite[] })?.recommendations ?? []).slice(0, 8);
    const summary = recs.length
      ? recs
          .map(
            (x) =>
              `${x.label} (id ${x.nodeId}, ${Math.round(Math.min(1, x.score) * 100)}% trust, ${
                x.hops === 1 ? "direct" : `${x.hops} hops via ${x.pathLabels.slice(1, -1).join("→") || "…"}`
              }${x.reasons.length ? `, reasons: ${x.reasons.slice(0, 3).join(", ")}` : ""})`,
          )
          .join("; ")
      : `no trusted paths for ${topic}${args.geo ? ` in ${String(args.geo)}` : ""} — consider proposing create_ask`;
    return { ok: true, summary, data: { topic, geo: str(args.geo, 80), recs } };
  },
};

const entitySearch: AgentTool = {
  name: "entity_search",
  description:
    "Find nodes in the user's graph by name (people, places, books, concepts…). Use it to resolve a name to a node id before publish_recommendation, add_trust or request_listen.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: { q: { type: "string", description: "Name or fragment, min 2 chars" } },
    required: ["q"],
  },
  async execute(input, ctx) {
    const q = str((input as Record<string, unknown>)?.q, 100);
    if (!q || q.length < 2) return { ok: false, summary: "q must be at least 2 characters" };
    const r = await graphFetch(ctx, `/api/search?q=${encodeURIComponent(q)}`);
    if (!r.ok) return fail(r.body, r.status);
    const nodes = (r.body as { id: string; label: string; type: string; sub?: string }[]) ?? [];
    const summary = nodes.length
      ? nodes.map((n) => `${n.label} (id ${n.id}, ${n.type}${n.sub ? `, ${n.sub}` : ""})`).join("; ")
      : `nothing in the graph matches "${q}"`;
    return { ok: true, summary, data: { nodes } };
  },
};

const saveNote: AgentTool = {
  name: "save_note",
  description:
    "Save text to the user's PRIVATE workspace (visible only to them). Use for notes, experiences and drafts the user wants to keep, or to park a recommendation draft before publishing.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string" },
      body: { type: "string", description: "The note text" },
      kind: {
        type: "string",
        enum: ["note", "experience", "recommendation_draft", "decision", "research"],
      },
      collections: { type: "array", items: { type: "string" }, description: "Optional folders" },
    },
    required: ["body"],
  },
  async execute(input, ctx) {
    const args = (input ?? {}) as Record<string, unknown>;
    const body = str(args.body, 20_000);
    if (!body) return { ok: false, summary: "body required" };
    const id = `wr_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const r = await graphFetch(ctx, "/api/writings/draft", {
      method: "POST",
      body: {
        id,
        title: str(args.title, 140),
        body,
        kind: str(args.kind, 40),
        collections: strArr(args.collections, 12),
      },
    });
    if (!r.ok) return fail(r.body, r.status);
    return { ok: true, summary: `saved privately (workspace doc ${id})`, data: { id } };
  },
};

const createAsk: AgentTool = {
  name: "create_ask",
  description:
    "Broadcast a need to the user's network (people who listen to them see it and can answer with recommendations). Use when the user expresses a need and trust_search found nothing (or they explicitly want to ask around).",
  confirm: true,
  confirmTitle: "Ask your network?",
  confirmDescription:
    "This broadcasts your need to people who listen to you. Their answers come back as recommendations.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      topic: { type: "string", description: `One of: ${TOPIC_LIST}` },
      geo: { type: "string", description: "City/area, lowercase, if relevant" },
      note: { type: "string", description: "One-line context for friends (max 200 chars)" },
    },
    required: ["topic"],
  },
  async execute(input, ctx) {
    const args = (input ?? {}) as Record<string, unknown>;
    const topic = canonicalTopic(args.topic);
    if (!topic) return topicError(args.topic);
    const r = await graphFetch(ctx, "/api/asks", {
      method: "POST",
      body: { topic, geo: str(args.geo, 80), note: str(args.note, 200) },
    });
    if (!r.ok) return fail(r.body, r.status);
    return {
      ok: true,
      summary: `asked the network for ${topic}${args.geo ? ` in ${String(args.geo)}` : ""} — answers will arrive as recommendations`,
      data: r.body,
    };
  },
};

const publishRecommendation: AgentTool = {
  name: "publish_recommendation",
  description:
    "Publish the user's recommendation of a graph node for a topic — it appears in the feed of everyone who listens to them. Resolve the target with entity_search first; targetId must be a real node id.",
  confirm: true,
  confirmTitle: "Publish this recommendation?",
  confirmDescription:
    "People who listen to you will see this in their feed. Recommendations are permanent evidence.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      targetId: { type: "string", description: "Node id from entity_search / trust_search" },
      topic: { type: "string", description: `One of: ${TOPIC_LIST}` },
      note: { type: "string", description: "Why — shown with the recommendation (max 500)" },
      reasons: { type: "array", items: { type: "string" }, description: "snake_case reason codes" },
    },
    required: ["targetId", "topic"],
  },
  async execute(input, ctx) {
    const args = (input ?? {}) as Record<string, unknown>;
    const topic = canonicalTopic(args.topic);
    if (!topic) return topicError(args.topic);
    const targetId = str(args.targetId, 200);
    if (!targetId) return { ok: false, summary: "targetId required" };
    const r = await graphFetch(ctx, "/api/recs", {
      method: "POST",
      body: { targetId, topic, note: str(args.note, 500), reasons: strArr(args.reasons) },
    });
    if (!r.ok) return fail(r.body, r.status);
    return { ok: true, summary: `recommendation published (${(r.body as { id?: string })?.id ?? "ok"})`, data: r.body };
  },
};

const addTrust: AgentTool = {
  name: "add_trust",
  description:
    "Record that the user trusts a person/provider for a topic (a directed, topic-scoped trust edge). Only when the user clearly states first-person trust. Resolve the node id with entity_search first.",
  confirm: true,
  confirmTitle: "Add this trust edge?",
  confirmDescription:
    "Trust is topic-scoped and flows to your network's search results. You can remove it later.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      to: { type: "string", description: "Node id of the trusted person/provider" },
      topic: { type: "string", description: `One of: ${TOPIC_LIST}` },
      geo: { type: "string" },
      reasons: { type: "array", items: { type: "string" }, description: "snake_case reason codes" },
      note: { type: "string" },
      confidence: { type: "number", description: "0..1, how strongly (default 0.8)" },
    },
    required: ["to", "topic"],
  },
  async execute(input, ctx) {
    const args = (input ?? {}) as Record<string, unknown>;
    const topic = canonicalTopic(args.topic);
    if (!topic) return topicError(args.topic);
    const to = str(args.to, 200);
    if (!to) return { ok: false, summary: "to (node id) required" };
    const confidence =
      typeof args.confidence === "number" ? Math.max(0, Math.min(1, args.confidence)) : undefined;
    const r = await graphFetch(ctx, "/api/trust", {
      method: "POST",
      body: {
        to,
        scope: { topic, geo: str(args.geo, 80) },
        reasons: strArr(args.reasons),
        note: str(args.note, 300),
        confidence,
      },
    });
    if (!r.ok) return fail(r.body, r.status);
    return { ok: true, summary: `trust edge recorded → ${to} on ${topic}` };
  },
};

const requestListen: AgentTool = {
  name: "request_listen",
  description:
    "Ask to listen to a person — their future recommendations then appear in the user's feed (uses a Listen slot; grants no trust). Resolve the person's node id with entity_search first.",
  confirm: true,
  confirmTitle: "Send a listen request?",
  confirmDescription:
    "Listening fills one of your slots and shows their recommendations in your feed. They may need to accept.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      targetId: { type: "string", description: "Person node id" },
    },
    required: ["targetId"],
  },
  async execute(input, ctx) {
    const targetId = str((input as Record<string, unknown>)?.targetId, 200);
    if (!targetId) return { ok: false, summary: "targetId required" };
    const r = await graphFetch(ctx, "/api/listen/requests", {
      method: "POST",
      body: { targetId },
    });
    if (!r.ok) return fail(r.body, r.status);
    const status = (r.body as { status?: string })?.status ?? "pending";
    return { ok: true, summary: `listen request ${status}`, data: r.body };
  },
};

/** The composer agent's tool set. Data-driven: sub-agents later register as
 *  `kind: "agent"` entries without touching the loop. */
export function buildComposerRegistry(extra: AgentTool[] = []): ToolRegistry {
  const tools = [
    trustSearch,
    entitySearch,
    saveNote,
    createAsk,
    publishRecommendation,
    addTrust,
    requestListen,
    ...extra,
  ];
  return new Map(tools.map((t) => [t.name, t]));
}
