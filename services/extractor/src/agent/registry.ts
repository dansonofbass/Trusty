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

/** Canonical geo: lowercase, bare city/district — "Gyumri, Armenia" → "gyumri". */
const cleanGeo = (v: unknown): string | undefined => {
  const raw = str(v, 80)?.toLowerCase();
  if (!raw) return undefined;
  return raw.replace(/[,\s]+armenia$/i, "").trim() || undefined;
};

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
      ...(ctx.app ? { "x-app": ctx.app } : {}),
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
    const geo = cleanGeo(args.geo);
    const r = await graphFetch(ctx, "/api/trust-search", {
      method: "POST",
      body: { topic, geo, context: str(args.context, 80) },
    });
    if (!r.ok) return fail(r.body, r.status);
    const recs = ((r.body as { recommendations?: TrustRecLite[] })?.recommendations ?? []).slice(0, 8);

    // #35: every meaningful search continues-or-creates a Decision Journey; the
    // search + its suggestions land on the journey timeline. Best-effort.
    let journeyId: string | undefined;
    let journeyCreated = false;
    try {
      const j = await graphFetch(ctx, "/api/journeys/auto", { method: "POST", body: { topic, geo } });
      if (j.ok) {
        const body = j.body as { journey: { id: string }; created: boolean };
        journeyId = body.journey.id;
        journeyCreated = body.created;
        await graphFetch(ctx, `/api/journeys/${journeyId}/events`, {
          method: "POST",
          body: { kind: "search", detail: { topic, geo, count: recs.length } },
        });
        for (const x of recs.slice(0, 5)) {
          await graphFetch(ctx, `/api/journeys/${journeyId}/events`, {
            method: "POST",
            body: { kind: "rec_suggested", detail: { nodeId: x.nodeId, label: x.label } },
          });
        }
      }
    } catch {
      /* journeys are additive — search results stand on their own */
    }

    const journeyNote = journeyId
      ? ` [decision journey ${journeyId}${journeyCreated ? " started" : " continued"} — refine it with update_journey, record choices with record_decision]`
      : "";
    const summary = recs.length
      ? recs
          .map(
            (x) =>
              `${x.label} (id ${x.nodeId}, ${Math.round(Math.min(1, x.score) * 100)}% trust, ${
                x.hops === 1 ? "direct" : `${x.hops} hops via ${x.pathLabels.slice(1, -1).join("→") || "…"}`
              }${x.reasons.length ? `, reasons: ${x.reasons.slice(0, 3).join(", ")}` : ""})`,
          )
          .join("; ") + journeyNote
      : `no trusted paths for ${topic}${geo ? ` in ${geo}` : ""} — consider proposing create_ask${journeyNote}`;
    return { ok: true, summary, data: { topic, geo, recs, journeyId } };
  },
};

/* ---- Decision Journey tools (#35): the journey is the working memory ---- */

const updateJourney: AgentTool = {
  name: "update_journey",
  description:
    "Refine a decision journey's context (goal, geo, budget, language, timeline, preferences, constraints) or add a note. Call whenever the user adds a detail about an ongoing decision — refinement never restarts the journey. Journey ids come from trust_search results or the <context> block.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      journeyId: { type: "string" },
      goal: { type: "string" },
      geo: { type: "string" },
      budget: { type: "string" },
      language: { type: "string" },
      timeline: { type: "string" },
      preferences: { type: "array", items: { type: "string" } },
      constraints: { type: "array", items: { type: "string" } },
      note: { type: "string", description: "Free-text note for the journey timeline" },
    },
    required: ["journeyId"],
  },
  async execute(input, ctx) {
    const args = (input ?? {}) as Record<string, unknown>;
    const journeyId = str(args.journeyId, 30);
    if (!journeyId) return { ok: false, summary: "journeyId required" };
    const patch: Record<string, unknown> = {};
    for (const k of ["goal", "geo", "budget", "language", "timeline"] as const) {
      const v = k === "geo" ? cleanGeo(args[k]) : str(args[k], 200);
      if (v) patch[k] = v;
    }
    for (const k of ["preferences", "constraints"] as const) {
      const v = strArr(args[k], 12);
      if (v?.length) patch[k] = v;
    }
    let summary = "";
    if (Object.keys(patch).length) {
      const r = await graphFetch(ctx, `/api/journeys/${journeyId}/events`, {
        method: "POST",
        body: { kind: "context", detail: { patch } },
      });
      if (!r.ok) return fail(r.body, r.status);
      summary = `journey ${journeyId} refined: ${Object.entries(patch)
        .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join("|") : v}`)
        .join(", ")}`;
    }
    const note = str(args.note, 300);
    if (note) {
      const r = await graphFetch(ctx, `/api/journeys/${journeyId}/events`, {
        method: "POST",
        body: { kind: "note", detail: { text: note } },
      });
      if (!r.ok) return fail(r.body, r.status);
      summary += `${summary ? "; " : ""}note added`;
    }
    if (!summary) return { ok: false, summary: "nothing to update — pass context fields or a note" };
    return { ok: true, summary };
  },
};

const recordDecision: AgentTool = {
  name: "record_decision",
  description:
    "Record the user's own stance on a recommendation inside their decision journey: saved (shortlist), dismissed (ruled out), or selected (they chose/contacted this one — the journey becomes 'decided'). Private to the user; use when they say things like 'I'll go with X', 'rule out Y', 'shortlist Z'.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      journeyId: { type: "string" },
      targetId: { type: "string", description: "Node id from trust_search/entity_search" },
      state: { type: "string", enum: ["saved", "dismissed", "selected"] },
      note: { type: "string" },
    },
    required: ["journeyId", "targetId", "state"],
  },
  async execute(input, ctx) {
    const args = (input ?? {}) as Record<string, unknown>;
    const journeyId = str(args.journeyId, 30);
    const targetId = str(args.targetId, 200);
    const state = str(args.state, 20);
    if (!journeyId || !targetId || !state) return { ok: false, summary: "journeyId, targetId and state required" };
    const kind = state === "selected" ? "rec_selected" : state === "saved" ? "rec_saved" : "rec_dismissed";
    const r = await graphFetch(ctx, `/api/journeys/${journeyId}/events`, {
      method: "POST",
      body: { kind, detail: { nodeId: targetId, ...(str(args.note, 300) ? { text: str(args.note, 300) } : {}) } },
    });
    if (!r.ok) return fail(r.body, r.status);
    const status = (r.body as { status?: string })?.status;
    return {
      ok: true,
      summary: `${state} ${targetId} on journey ${journeyId}${status === "decided" ? " — journey is now decided; suggest recording the outcome later" : ""}`,
    };
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

const searchAnswersTool: AgentTool = {
  name: "search_answers",
  description:
    "Search the community's SAVED ANSWERS — messages members pinned as reusable knowledge in their circles (procedures, rules, provider tips, gotchas). ALWAYS try this FIRST for how-to / procedure / rule / \u201cwhich provider\u201d questions. When citing one, name the author and the date; if it's older than ~2 months, add that rules may have changed since.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      query: { type: "string", description: "Keywords, e.g. 'residency documents OVIR'" },
    },
    required: ["query"],
  },
  async execute(input, ctx) {
    const q = str((input as Record<string, unknown>)?.query, 200);
    if (!q) return { ok: false, summary: "query required" };
    const r = await graphFetch(ctx, `/api/answers/search?q=${encodeURIComponent(q)}`);
    if (!r.ok) return fail(r.body, r.status);
    const answers =
      (r.body as { answers?: { body: string; author: string; room: string; savedAt: string }[] } | null)
        ?.answers ?? [];
    if (!answers.length) {
      return {
        ok: true,
        summary: `no saved answers match "${q}" — answer from general knowledge, and suggest saving good answers from circle chats so the next person finds them`,
      };
    }
    const when = (iso: string) =>
      new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric" });
    const summary = answers
      .map((a) => `\u00ab${a.body.slice(0, 300)}\u00bb \u2014 ${a.author}, in ${a.room}, ${when(a.savedAt)}`)
      .join("\n");
    return { ok: true, summary, data: { answers } };
  },
};

const webSearch: AgentTool = {
  name: "web_search",
  description:
    "Search the public web for CURRENT facts the community graph can't know: official rules and procedures, government/bank announcements, prices, opening hours, news, or anything time-sensitive. Use AFTER search_answers when the community has no saved answer, or to CHECK whether a saved answer is still current. Always tell the user what you found came from the web (with the source name) rather than from their trusted network.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      query: { type: "string", description: "Search query, e.g. 'Armenia residence permit application 2026 permit.am'" },
      site: { type: "string", description: "Optional domain to restrict to, e.g. 'e-gov.am'" },
    },
    required: ["query"],
  },
  async execute(input, ctx) {
    const args = (input ?? {}) as Record<string, unknown>;
    const query = str(args.query, 200);
    if (!query) return { ok: false, summary: "query required" };
    const site = str(args.site, 80);
    const key = (process.env.SERPAPI_KEYS ?? "").split(",")[0]?.trim();
    if (!key) return { ok: false, summary: "web search is not configured on this deployment" };
    const qs = new URLSearchParams({
      engine: "google",
      q: site ? `site:${site} ${query}` : query,
      num: "6",
      api_key: key,
    });
    let results: { title?: string; link?: string; snippet?: string; date?: string }[] = [];
    let answerBox: { answer?: string; snippet?: string } | undefined;
    try {
      const r = await fetch(`https://serpapi.com/search.json?${qs}`, { signal: ctx.signal });
      const body = (await r.json()) as {
        organic_results?: typeof results;
        answer_box?: typeof answerBox;
        error?: string;
      };
      if (body.error) return { ok: false, summary: `web search failed: ${body.error}` };
      results = (body.organic_results ?? []).slice(0, 6);
      answerBox = body.answer_box;
    } catch {
      return { ok: false, summary: "web search unreachable" };
    }
    if (!results.length && !answerBox) {
      return { ok: true, summary: `the web has nothing useful for "${query}"` };
    }
    const lines = [
      ...(answerBox?.answer || answerBox?.snippet ? [`Featured: ${answerBox.answer ?? answerBox.snippet}`] : []),
      ...results.map((x) => {
        const host = (() => {
          try { return new URL(x.link ?? "").hostname.replace(/^www\./, ""); } catch { return "web"; }
        })();
        return `${x.title ?? "(untitled)"} — ${host}${x.date ? ` (${x.date})` : ""}: ${(x.snippet ?? "").slice(0, 220)}`;
      }),
    ];
    return {
      ok: true,
      summary: lines.join("
"),
      data: { query, results: results.map((x) => ({ title: x.title, link: x.link, snippet: x.snippet })) },
    };
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
      body: { topic, geo: cleanGeo(args.geo), note: str(args.note, 200) },
    });
    if (!r.ok) return fail(r.body, r.status);
    return {
      ok: true,
      summary: `asked the network for ${topic}${args.geo ? ` in ${String(args.geo)}` : ""} — answers will arrive as recommendations`,
      data: r.body,
    };
  },
};

const recommend: AgentTool = {
  name: "recommend",
  description:
    "The user vouches for a person/provider/place on a topic. ALWAYS records a directed, topic-scoped trust edge (their quiet, revocable reliance — powers their network's searches). With share=true (the default) it ALSO publishes an immutable recommendation into the feeds of everyone who listens to them. Use share=false when the user wants trust recorded without broadcasting. Only for clear first-person endorsement; resolve the node id with entity_search first.",
  confirm: true,
  confirmTitle: "Recommend them?",
  confirmDescription:
    "Records topic-scoped trust (removable later). If shared, listeners also see it in their feed — published recommendations are permanent evidence.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      targetId: { type: "string", description: "Node id from entity_search / trust_search" },
      topic: { type: "string", description: `One of: ${TOPIC_LIST}` },
      geo: { type: "string" },
      context: { type: "string", description: "Use-case context (e.g. family_visa_case)" },
      reasons: { type: "array", items: { type: "string" }, description: "snake_case reason codes" },
      note: { type: "string", description: "Why — shown with the recommendation (max 500)" },
      confidence: { type: "number", description: "0..1 trust strength (default 0.8)" },
      share: {
        type: "boolean",
        description: "true (default): also publish to listeners' feeds; false: quiet trust only",
      },
    },
    required: ["targetId", "topic"],
  },
  async execute(input, ctx) {
    const args = (input ?? {}) as Record<string, unknown>;
    const topic = canonicalTopic(args.topic);
    if (!topic) return topicError(args.topic);
    const targetId = str(args.targetId, 200);
    if (!targetId) return { ok: false, summary: "targetId required" };
    const share = args.share !== false;
    const note = str(args.note, 500);
    const reasons = strArr(args.reasons);
    const confidence =
      typeof args.confidence === "number" ? Math.max(0, Math.min(1, args.confidence)) : undefined;
    // Trust edge first — recommending IS relying; it's the quiet, revocable half.
    const t = await graphFetch(ctx, "/api/trust", {
      method: "POST",
      body: {
        to: targetId,
        scope: { topic, geo: cleanGeo(args.geo), context: str(args.context, 120) },
        reasons,
        note,
        confidence,
      },
    });
    if (!t.ok) return fail(t.body, t.status);
    if (!share) {
      return { ok: true, summary: `quiet trust recorded → ${targetId} on ${topic} (not shared with listeners)` };
    }
    const r = await graphFetch(ctx, "/api/recs", {
      method: "POST",
      body: { targetId, topic, context: str(args.context, 120), reasons, note },
    });
    if (!r.ok) {
      return {
        ok: true,
        summary: `trust recorded → ${targetId} on ${topic}, but publishing to listeners failed: ${
          (r.body as { error?: string } | null)?.error ?? r.status
        }`,
      };
    }
    return {
      ok: true,
      summary: `recommended ${targetId} on ${topic} — trust recorded AND published to listeners (rec ${(r.body as { id?: string })?.id ?? "ok"})`,
      data: r.body,
    };
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
    searchAnswersTool,
    webSearch,
    saveNote,
    updateJourney,
    recordDecision,
    createAsk,
    recommend,
    requestListen,
    ...extra,
  ];
  return new Map(tools.map((t) => [t.name, t]));
}
