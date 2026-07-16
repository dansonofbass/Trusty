/**
 * extractor — turns a piece of writing into graph structure (nodes + edges).
 *
 * POST /extract  { text, title? }   → ThoughtExtraction (entities + relations)
 * POST /ingest   { authorId, text } → mutates graph-service with the thought,
 *                                      its concepts, and their relations.
 *
 * Three extraction providers are available:
 *   • Ollama (LangExtract-style) — a local LLM extracts grounded, grouped
 *     entities which are folded into nodes + edges. The technique is from
 *     "A Practical GraphRAG Architecture Using LangExtract, Neo4j, Qdrant and
 *     Ollama". Configured via OLLAMA_HOST (or USE_OLLAMA=1).
 *   • Claude Messages API — a hosted model (e.g. Haiku); needs ANTHROPIC_API_KEY.
 *   • Deterministic heuristic — offline fallback so the pipeline always works.
 *
 * Which one runs is decided PER REQUEST by ./router (manual override → A/B test
 * → default), so the local model and Claude can be A/B-tested across users or
 * pinned manually. See router.ts for the env knobs (EXTRACTOR_PROVIDER,
 * EXTRACTOR_AB_TEST, EXTRACTOR_MODEL, EXTRACTOR_ALLOW_OVERRIDE).
 */
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import express from "express";
import cors from "cors";
import Anthropic from "@anthropic-ai/sdk";

// Load the repo-root .env (OLLAMA_HOST, ANTHROPIC_API_KEY, …) when present, so
// `npm run dev:extractor` works without exporting vars by hand. Best-effort:
// in containers the env is already injected via docker-compose.
try {
  const here = dirname(fileURLToPath(import.meta.url));
  (process as NodeJS.Process & { loadEnvFile?: (p: string) => void }).loadEnvFile?.(
    resolve(here, "../../../.env"),
  );
} catch {
  /* no .env at the repo root — rely on the ambient environment */
}

import {
  EXTRACTION_SYSTEM_PROMPT,
  summitExtractionSystemPrompt,
  buildLangExtractPrompt,
  buildSummitLangExtractPrompt,
  convertExtractionsToGraph,
  heuristicExtract,
  summitHeuristicExtract,
  coerceNotePrivacy,
  type NotePrivacy,
  parseEnabledSourceProviders,
  resolveWikipediaSource,
  TOPIC_TAXONOMY,
  normalizeTopic,
  reasonsForTopic,
  validateScope,
  type AgentMessage,
  type AgentResume,
  type AgentStreamEvent,
  type LxResult,
  type ResolvedMention,
  type ThoughtExtraction,
  type TrustScope,
} from "@constellation/graph-core";

import {
  applyOverrides,
  buildRouterConfig,
  describeRouter,
  parseAbConfig,
  resolveVariant,
  variantKeyAvailable,
  type ResolvedVariant,
  type RoutingOverrides,
} from "./router";
import { createConfigStore } from "./configStore";
import { gatewayChat, litellmConfigured, type GatewayCallMeta } from "./llmGateway";
import { agentConfigured } from "./agent/gateway";
import { runAgentLoop } from "./agent/loop";
import { buildComposerRegistry } from "./agent/registry";
import { AGENT_SYSTEM_PROMPT, buildContextBlock } from "./agent/prompt";

const PORT = Number(process.env.PORT ?? 4003);
const GRAPH = process.env.GRAPH_SERVICE_URL ?? "http://localhost:4001";
const apiKey = process.env.ANTHROPIC_API_KEY;

// Ollama endpoint (the model used is decided per request by the router).
const ollamaHost = (process.env.OLLAMA_HOST?.replace(/\/+$/, "")) ?? "http://localhost:11434";

// A single Claude client (the specific model is chosen per request by the router).
const anthropic = apiKey ? new Anthropic({ apiKey }) : null;

// Routing = env baseline + admin overrides (persisted). The admin panel mutates
// the overrides via /admin/routing; everything else reads the effective config.
const baseConfig = buildRouterConfig(process.env);
const configStore = await createConfigStore(process.env.DATABASE_URL);

/** The live config: env defaults with the admin overrides layered on top. */
const effectiveConfig = () => applyOverrides(baseConfig, configStore.get());

/**
 * Resolve the variant for a request from override headers/body fields and the
 * authenticated user id (forwarded by the BFF as `x-user-id`).
 */
function variantForRequest(
  req: express.Request,
  body?: { model?: unknown; provider?: unknown },
): ResolvedVariant {
  const header = (name: string) => {
    const v = req.header(name);
    return typeof v === "string" && v.trim() ? v.trim() : undefined;
  };
  const bodyStr = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  return resolveVariant(effectiveConfig(), {
    userId: header("x-user-id"),
    overrideModel: header("x-extractor-model") ?? bodyStr(body?.model),
    overrideProvider: header("x-extractor-provider") ?? bodyStr(body?.provider),
  });
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) =>
  res.json({
    ok: true,
    service: "extractor",
    // Provider + model are now resolved per request; `routing` describes the
    // default, the active A/B experiment (if any), and what's configured.
    routing: describeRouter(effectiveConfig()),
    ollamaHost: baseConfig.ollamaConfigured ? ollamaHost : undefined,
    entitySources: parseEnabledSourceProviders(process.env.ENTITY_SOURCES),
    // Composer agent (#29): tool-calling loop, needs LiteLLM or an Anthropic key.
    agent: agentConfigured() ? "enabled" : "disabled",
  }),
);

/* ── Admin: read & set the routing config ──────────────────────────────
 * The extractor is internal-only; the BFF gates these by the Keycloak admin
 * role before proxying. As defence in depth, when EXTRACTOR_ADMIN_SECRET is
 * set the caller must also present it as `x-admin-secret`. */
const ADMIN_SECRET = process.env.EXTRACTOR_ADMIN_SECRET;

function adminAllowed(req: express.Request): boolean {
  if (!ADMIN_SECRET) return true; // dev: trust the BFF on the internal network
  return req.header("x-admin-secret") === ADMIN_SECRET;
}

/** The current routing state + the choices an admin can pick from. */
function adminState() {
  const cfg = effectiveConfig();
  const suggestions = [
    { key: "ollama", available: cfg.ollamaConfigured, label: `Local · Ollama (${baseConfig.ollamaModel})` },
    { key: "claude", available: cfg.claudeConfigured, label: `Claude · ${baseConfig.defaultClaudeModel}` },
    { key: "heuristic", available: true, label: "Heuristic (offline)" },
  ];
  return {
    effective: describeRouter(cfg),
    overrides: configStore.get(),
    meta: configStore.meta(),
    base: { default: baseConfig.defaultKey, claudeModel: baseConfig.defaultClaudeModel, ollamaModel: baseConfig.ollamaModel },
    suggestions,
  };
}

app.get("/admin/routing", (req, res) => {
  if (!adminAllowed(req)) return res.status(403).json({ error: "forbidden" });
  res.json(adminState());
});

app.put("/admin/routing", async (req, res) => {
  if (!adminAllowed(req)) return res.status(403).json({ error: "forbidden" });

  const body = (req.body ?? {}) as Record<string, unknown>;
  const patch: RoutingOverrides = {};
  const cfg = effectiveConfig();

  // defaultKey — must resolve to an available provider/model.
  if (body.defaultKey !== undefined) {
    const key = String(body.defaultKey).trim();
    if (key) {
      const check = variantKeyAvailable(key, cfg);
      if (!check.ok) return res.status(400).json({ error: `default "${key}": ${check.reason}` });
    }
    patch.defaultKey = key;
  }

  // abTest — validate every arm resolves to an available provider/model.
  if (body.abTest !== undefined) {
    const raw = String(body.abTest).trim();
    if (raw) {
      const buckets = parseAbConfig(raw);
      if (buckets.length === 0) {
        return res.status(400).json({ error: "abTest: could not parse any arms (use key=weight,key=weight)" });
      }
      for (const b of buckets) {
        const check = variantKeyAvailable(b.key, cfg);
        if (!check.ok) return res.status(400).json({ error: `A/B arm "${b.key}": ${check.reason}` });
      }
    }
    patch.abTest = raw;
  }

  if (body.abSalt !== undefined) patch.abSalt = String(body.abSalt).trim();
  if (body.allowOverride !== undefined) patch.allowOverride = Boolean(body.allowOverride);

  try {
    await configStore.set(patch, req.header("x-user-id") || undefined);
    res.json(adminState());
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Pull the first balanced JSON object out of a string (defensive parsing). */
function firstJsonObject(s: string): unknown {
  const start = s.indexOf("{");
  if (start < 0) throw new Error("model returned no JSON");
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return JSON.parse(s.slice(start, i + 1));
  }
  throw new Error("model returned unbalanced JSON");
}

function coerce(raw: unknown): ThoughtExtraction {
  const o = (raw ?? {}) as Record<string, unknown>;
  const entities = Array.isArray(o.entities) ? o.entities : [];
  const relations = Array.isArray(o.relations) ? o.relations : [];
  return {
    title: typeof o.title === "string" ? o.title : undefined,
    summary: typeof o.summary === "string" ? o.summary : undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    entities: entities.filter((e: any) => e && typeof e.name === "string"),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    relations: relations.filter((r: any) => r && r.source && r.target),
  };
}

type SseSend = (payload: Record<string, unknown>) => void;

/**
 * LangExtract-style extraction on a local Ollama model.
 */
async function ollamaExtractStream(
  text: string,
  model: string,
  send?: SseSend,
  promptBuilder: (t: string) => { system: string; user: string } = buildLangExtractPrompt,
): Promise<{ extraction: ThoughtExtraction; raw: string; via: string }> {
  const { system, user } = promptBuilder(text.slice(0, 12000));
  send?.({ type: "phase", phase: "llm", label: `Ollama · ${model}`, progress: 15 });

  const r = await fetch(`${ollamaHost}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      stream: true,
      format: "json",
      options: { temperature: 0.2 },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!r.ok) throw new Error(`ollama responded ${r.status}: ${await r.text().catch(() => "")}`);

  let raw = "";
  const reader = r.body?.getReader();
  if (!reader) throw new Error("ollama returned no stream body");
  const dec = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const chunk = JSON.parse(line) as { message?: { content?: string } };
        const piece = chunk.message?.content ?? "";
        if (piece) {
          raw += piece;
          send?.({ type: "token", content: piece });
        }
      } catch {
        /* ignore partial lines */
      }
    }
  }

  send?.({ type: "phase", phase: "parse", label: "Parsing entities & relations", progress: 72 });
  const lx = firstJsonObject(raw) as LxResult;
  const extraction = convertExtractionsToGraph(lx);
  return { extraction, raw, via: `ollama:${model}` };
}

async function enrichWithProgress(
  extraction: ThoughtExtraction,
  send?: SseSend,
): Promise<ThoughtExtraction> {
  const providers = parseEnabledSourceProviders(process.env.ENTITY_SOURCES);
  if (!providers.includes("wikipedia") || extraction.entities.length === 0) {
    send?.({ type: "phase", phase: "sources", label: "Sources skipped", progress: 88 });
    return extraction;
  }

  send?.({
    type: "phase",
    phase: "sources",
    label: "Linking Wikipedia sources",
    progress: 78,
  });

  const ranked = [...extraction.entities]
    .sort((a, b) => (b.salience ?? 0.5) - (a.salience ?? 0.5))
    .slice(0, 10);

  const resolved = new Map<string, NonNullable<Awaited<ReturnType<typeof resolveWikipediaSource>>>>();

  for (let i = 0; i < ranked.length; i++) {
    const entity = ranked[i];
    const source = await resolveWikipediaSource(entity.name);
    if (source) resolved.set(entity.name, source);
    send?.({
      type: "source",
      entity: entity.name,
      resolved: !!source,
    });
    send?.({
      type: "phase",
      phase: "sources",
      label: `Wikipedia · ${entity.name}`,
      progress: 78 + Math.round(((i + 1) / ranked.length) * 12),
    });
  }

  const entities = extraction.entities.map((e) => {
    const source = resolved.get(e.name);
    if (!source) return e;
    return { ...e, sources: [source] };
  });

  return { ...extraction, entities };
}

/** Per-request context used to tag gateway traces (Langfuse) and route. */
interface ExtractCtx {
  userId?: string;
  endpoint: string;
  sessionId?: string;
  /** Prompt taxonomy: "summit" = Trusty Sevan meeting notes (needs/tech/APIs…). */
  domain?: string;
  /** Admin-managed entity kinds for the summit taxonomy (app config.noteKinds). */
  kinds?: string[];
}

/* ── Trust extraction + scope resolution (MVP §5, §15–16) ─────────────── */

/** A trust the AUTHOR expresses about a provider/person, awaiting confirmation. */
interface TrustAssertion {
  object: string;
  object_kind?: string;
  scope: TrustScope;
  reasons: string[];
  confidence: number;
}

const TOPIC_LIST = TOPIC_TAXONOMY.join(", ");

// Only spend a trust pass when the text plausibly expresses trust.
const TRUST_CUE =
  /\b(trust|recommend|recommends|recommended|vouch|swear by|go to|reliable|honest|my (broker|lawyer|doctor|dentist|mechanic|accountant|plumber|electrician|realtor))\b/i;

const TRUST_EXTRACTION_PROMPT = `You extract TRUST ASSERTIONS that the AUTHOR makes in the first person ("I", "we") about a specific person or provider they trust or recommend.

Return ONLY JSON: {"assertions":[{"object": string, "object_kind": "person"|"business", "scope": {"topic": string, "entity"?: string, "context"?: string, "preferences"?: string[], "geo"?: string}, "reasons": string[], "confidence": number}]}

Rules:
- "topic" MUST be one of: ${TOPIC_LIST}. Pick the closest. If none fits, skip the assertion.
- "object" is the trusted person/provider's name exactly as written.
- "geo" is a city/area if mentioned (lowercase).
- "reasons" are short snake_case codes (e.g. honest, fair_price, responsive, good_negotiation, food_quality, professional).
- "confidence" in [0,1] reflects how strongly the author trusts them.
- Only first-person trust. Do NOT invent assertions. Empty array if none.`;

const RESOLVE_SCOPE_PROMPT = `Resolve a search query into a trust scope. Return ONLY JSON: {"topic": string, "entity"?: string, "context"?: string, "preferences"?: string[], "geo"?: string}.
"topic" MUST be one of: ${TOPIC_LIST}. "geo" is a city/area if present (lowercase). "context" is the use-case if clear (e.g. date_night, remote_work). Keep it minimal.`;

/** Keyword fallback for scope resolution (offline / gateway down). */
function keywordResolveScope(q: string): TrustScope {
  const lower = ` ${q.toLowerCase()} `;
  let topic = "";
  for (const t of TOPIC_TAXONOMY) {
    if (lower.includes(` ${t.replace(/_/g, " ")} `)) { topic = t; break; }
  }
  if (!topic) {
    for (const w of q.toLowerCase().split(/\s+/)) {
      const n = normalizeTopic(w);
      if (TOPIC_TAXONOMY.includes(n)) { topic = n; break; }
    }
  }
  const m = q.toLowerCase().match(/\bin\s+([a-z][a-z .'-]+)\s*$/);
  const geo = m ? m[1].trim() : undefined;
  return validateScope({ topic, geo });
}

/** Resolve a natural-language query → structured trust scope (gateway + fallback). */
async function resolveScope(q: string, variant: ResolvedVariant, ctx: ExtractCtx): Promise<TrustScope> {
  if (litellmConfigured() && variant.provider === "claude") {
    try {
      const raw = await gatewayChat({
        model: variant.model,
        system: RESOLVE_SCOPE_PROMPT,
        user: q,
        json: true,
        meta: {
          userId: ctx.userId,
          variant: variant.key,
          source: variant.source,
          provider: variant.provider,
          endpoint: "resolve_scope",
        },
      });
      const parsed = firstJsonObject(raw) as Partial<TrustScope>;
      const scope = validateScope(parsed);
      if (scope.topic) return scope;
    } catch (e) {
      console.error("resolve-scope gateway failed, using keyword fallback:", e);
    }
  }
  return keywordResolveScope(q);
}

/** Trust-suggestion pass over a thought (gateway only; gated by a trust cue). */
async function extractTrustAssertions(
  text: string,
  variant: ResolvedVariant,
  ctx: ExtractCtx,
): Promise<TrustAssertion[]> {
  if (!litellmConfigured() || variant.provider !== "claude") return [];
  if (text.length < 40 || !TRUST_CUE.test(text)) return [];
  try {
    const raw = await gatewayChat({
      model: variant.model,
      system: TRUST_EXTRACTION_PROMPT,
      user: text.slice(0, 12000),
      json: true,
      meta: {
        userId: ctx.userId,
        variant: variant.key,
        source: variant.source,
        provider: variant.provider,
        endpoint: "extract_trust",
        sessionId: ctx.sessionId,
      },
    });
    const obj = firstJsonObject(raw) as { assertions?: unknown };
    const list = Array.isArray(obj.assertions) ? obj.assertions : [];
    const out: TrustAssertion[] = [];
    for (const a of list as Record<string, unknown>[]) {
      if (!a || typeof a.object !== "string") continue;
      const scope = validateScope((a.scope ?? {}) as Partial<TrustScope>);
      if (!scope.topic) continue;
      const allowed = new Set(reasonsForTopic(scope.topic));
      const reasons = Array.isArray(a.reasons)
        ? (a.reasons as unknown[]).map(String).filter((r) => allowed.has(r))
        : [];
      out.push({
        object: a.object,
        object_kind: typeof a.object_kind === "string" ? a.object_kind : undefined,
        scope,
        reasons,
        confidence: typeof a.confidence === "number" ? Math.max(0, Math.min(1, a.confidence)) : 0.7,
      });
    }
    return out;
  } catch (e) {
    console.error("trust extraction failed:", e);
    return [];
  }
}

async function extractCore(
  text: string,
  variant: ResolvedVariant,
  ctx: ExtractCtx,
  send?: SseSend,
): Promise<{
  extraction: ThoughtExtraction;
  via: string;
  variant: ResolvedVariant;
  rawModelOutput?: string;
  trustAssertions: TrustAssertion[];
  /** Summit meeting notes only: "is this safe to post publicly?" assessment. */
  privacy?: NotePrivacy;
}> {
  let extraction: ThoughtExtraction;
  let via: string;
  let rawModelOutput: string | undefined;

  const clipped = text.slice(0, 12000);
  const useGateway = litellmConfigured();
  // Domain-specific taxonomy: Trusty Sevan meeting notes extract networking
  // entities (needs/tech/APIs/investors…) instead of the knowledge taxonomy.
  const summit = ctx.domain === "summit";
  const systemPrompt = summit ? summitExtractionSystemPrompt(ctx.kinds) : EXTRACTION_SYSTEM_PROMPT;
  const langPrompt = summit
    ? (t: string) => buildSummitLangExtractPrompt(t, ctx.kinds)
    : buildLangExtractPrompt;
  const heuristic = summit ? summitHeuristicExtract : heuristicExtract;
  const gmeta = (): GatewayCallMeta => ({
    userId: ctx.userId,
    variant: variant.key,
    source: variant.source,
    provider: variant.provider,
    endpoint: ctx.endpoint,
    sessionId: ctx.sessionId,
  });
  const tok = (t: string) => send?.({ type: "token", content: t });

  send?.({ type: "phase", phase: "prepare", label: "Reading your text", progress: 5 });

  if (variant.provider === "ollama") {
    try {
      if (useGateway) {
        // Local model via the gateway → logged + costed in Langfuse like any other.
        const { system, user } = langPrompt(clipped);
        send?.({ type: "phase", phase: "llm", label: `Gateway · ${variant.model}`, progress: 15 });
        const raw = await gatewayChat({ model: variant.model, system, user, json: true, meta: gmeta(), onToken: tok });
        send?.({ type: "phase", phase: "parse", label: "Parsing entities & relations", progress: 72 });
        extraction = convertExtractionsToGraph(firstJsonObject(raw) as LxResult);
        via = `litellm:${variant.model}`;
        rawModelOutput = raw;
      } else {
        const r = await ollamaExtractStream(text, variant.model, send, langPrompt);
        extraction = r.extraction;
        via = r.via;
        rawModelOutput = r.raw;
      }
    } catch (e) {
      console.error("ollama extraction failed, falling back to heuristic:", e);
      extraction = heuristic(text);
      via = "heuristic (ollama failed)";
      send?.({ type: "phase", phase: "parse", label: "Heuristic fallback", progress: 72 });
    }
  } else if (variant.provider === "claude" && (useGateway || anthropic)) {
    try {
      send?.({
        type: "phase",
        phase: "llm",
        label: `${useGateway ? "Gateway" : "Claude"} · ${variant.model}`,
        progress: 15,
      });
      let out = "";
      if (useGateway) {
        out = await gatewayChat({
          model: variant.model,
          system: systemPrompt,
          user: clipped,
          meta: gmeta(),
          onToken: tok,
        });
      } else {
        const stream = anthropic!.messages.stream({
          model: variant.model,
          max_tokens: 1400,
          system: systemPrompt,
          messages: [{ role: "user", content: clipped }],
        });
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            out += event.delta.text;
            tok(event.delta.text);
          }
        }
      }
      rawModelOutput = out;
      send?.({ type: "phase", phase: "parse", label: "Parsing entities & relations", progress: 72 });
      extraction = coerce(firstJsonObject(out));
      via = useGateway ? `litellm:${variant.model}` : variant.model;
    } catch (e) {
      console.error("claude extraction failed, falling back to heuristic:", e);
      extraction = heuristic(text);
      via = "heuristic (claude failed)";
      send?.({ type: "phase", phase: "parse", label: "Heuristic fallback", progress: 72 });
    }
  } else {
    send?.({ type: "phase", phase: "llm", label: "Heuristic extraction", progress: 20 });
    await new Promise((r) => setTimeout(r, 400));
    extraction = heuristic(text);
    via = "heuristic";
    rawModelOutput = JSON.stringify(extraction, null, 2);
    send?.({ type: "token", content: rawModelOutput });
    send?.({ type: "phase", phase: "parse", label: "Parsing entities & relations", progress: 72 });
  }

  extraction = await enrichWithProgress(extraction, send);

  // Trust-suggestion pass (Doc §15) — proposed only; the user confirms before write.
  // Skipped for summit meeting notes: at an event, match — not trust — is the signal.
  let trustAssertions: TrustAssertion[] = [];
  if (!summit) {
    send?.({ type: "phase", phase: "trust", label: "Spotting who you trust", progress: 90 });
    trustAssertions = await extractTrustAssertions(text, variant, ctx);
    if (trustAssertions.length) send?.({ type: "trust", assertions: trustAssertions });
  }

  // Privacy screen (summit only): the model's own "privacy" field when present,
  // hardened by the deterministic regex heuristic (which can only add caution).
  let privacy: NotePrivacy | undefined;
  if (summit) {
    let rawPrivacy: unknown;
    try {
      rawPrivacy = rawModelOutput
        ? (firstJsonObject(rawModelOutput) as { privacy?: unknown }).privacy
        : undefined;
    } catch {
      /* fall back to the heuristic */
    }
    privacy = coerceNotePrivacy(rawPrivacy, text);
    send?.({ type: "privacy", ...privacy });
  }

  send?.({ type: "phase", phase: "done", label: "Extraction complete", progress: 92 });
  return { extraction, via, variant, rawModelOutput, trustAssertions, privacy };
}

async function extract(
  text: string,
  variant: ResolvedVariant,
  ctx: ExtractCtx,
): Promise<{ extraction: ThoughtExtraction; via: string; privacy?: NotePrivacy }> {
  const { extraction, via, privacy } = await extractCore(text, variant, ctx);
  return { extraction, via, privacy };
}

app.post("/extract", async (req, res) => {
  const text = String(req.body?.text ?? "").trim();
  if (text.length < 12) return res.status(400).json({ error: "need at least a sentence" });
  const variant = variantForRequest(req, req.body);
  try {
    const { extraction, via, privacy } = await extract(text, variant, {
      userId: req.header("x-user-id") || undefined,
      endpoint: "extract",
      domain: typeof req.body?.domain === "string" ? req.body.domain : undefined,
      kinds: Array.isArray(req.body?.kinds) ? req.body.kinds.map(String).slice(0, 24) : undefined,
    });
    res.json({ via, variant: variant.key, variantSource: variant.source, ...(privacy ? { privacy } : {}), ...extraction });
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** SSE stream: phases, LLM tokens, Wikipedia lookups, final extraction. */
app.post("/extract/stream", async (req, res) => {
  const text = String(req.body?.text ?? "").trim();
  if (text.length < 12) return res.status(400).json({ error: "need at least a sentence" });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (payload: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const variant = variantForRequest(req, req.body);

  try {
    const { extraction, via, rawModelOutput, trustAssertions, privacy } = await extractCore(
      text,
      variant,
      {
        userId: req.header("x-user-id") || undefined,
        endpoint: "extract_stream",
        domain: typeof req.body?.domain === "string" ? req.body.domain : undefined,
        kinds: Array.isArray(req.body?.kinds) ? req.body.kinds.map(String).slice(0, 24) : undefined,
      },
      send,
    );
    send({
      type: "done",
      via,
      variant: variant.key,
      variantSource: variant.source,
      extraction,
      rawModelOutput,
      trustAssertions,
      privacy,
    });
    res.end();
  } catch (e) {
    send({ type: "error", message: e instanceof Error ? e.message : String(e) });
    res.end();
  }
});

/** Extract, then push the thought into graph-service; returns the new graph. */
app.post("/ingest", async (req, res) => {
  const text = String(req.body?.text ?? "").trim();
  // The authenticated user is forwarded by the BFF as X-User-Id; prefer it over
  // the (client-supplied) authorId so the thought is authored by the real user.
  const userId = (req.header("x-user-id") || req.body?.authorId || "me").toString();
  const precomputed = req.body?.extraction as ThoughtExtraction | undefined;
  // The model's pre-edit extraction (when the client computed it), so the
  // graph-service writings log can record what the user changed.
  const originalExtraction = req.body?.originalExtraction as ThoughtExtraction | undefined;
  const writingId = req.body?.writingId as string | undefined;
  // User-confirmed trust suggestions (Doc §15) — forwarded as-is; never auto-created.
  const trustAssertions = Array.isArray(req.body?.trustAssertions) ? req.body.trustAssertions : [];
  if (text.length < 12) return res.status(400).json({ error: "need at least a sentence" });
  try {
    const extraction =
      precomputed ??
      (
        await extract(text, variantForRequest(req, req.body), {
          userId,
          endpoint: "ingest",
          sessionId: writingId,
        })
      ).extraction;
    const r = await fetch(`${GRAPH}/api/thoughts`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-user-id": userId,
      },
      body: JSON.stringify({ authorId: userId, text, extraction, originalExtraction, writingId, trustAssertions }),
    });
    const body = await r.json();
    if (!r.ok) throw new Error(body?.error ?? `graph-service ${r.status}`);
    res.json(body);
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/* ── Trusty Sevan agent search ──────────────────────────────────────── */

interface SevanVocab {
  types?: string[];
  industry?: string[];
  tech?: string[];
  country?: string[];
  stage?: string[];
  skill?: string[];
}
interface SevanFilters {
  type?: string;
  industry?: string;
  tech?: string;
  country?: string;
  stage?: string;
  skill?: string;
}

/** Deterministic query→filters: match query tokens against the (client-sent,
 *  admin-authored) vocabularies. Always works — model output can only refine. */
function sevanQueryHeuristic(query: string, vocab: SevanVocab): SevanFilters {
  const q = query.toLowerCase();
  const out: SevanFilters = {};
  const hit = (opts?: string[]) =>
    opts?.find((o) => q.includes(o.toLowerCase().replace(/_/g, " ")) || q.includes(o.toLowerCase()));
  // role words (incl. plurals/synonyms) → type
  const ROLE_WORDS: [string, string[]][] = [
    ["startup", ["startups", "startup", "companies", "teams"]],
    ["founder", ["founders", "founder", "cofounder"]],
    ["mentor", ["mentors", "mentor", "advisors", "advisor", "coach"]],
    ["investor", ["investors", "investor", "vc", "vcs", "angel", "angels", "fund"]],
    ["expert", ["experts", "expert", "specialists", "specialist"]],
    ["workshop", ["workshops", "workshop", "sessions", "session", "talks"]],
  ];
  for (const [type, words] of ROLE_WORDS) {
    if ((vocab.types ?? []).includes(type) && words.some((w) => q.includes(w))) {
      out.type = type;
      break;
    }
  }
  const ind = hit(vocab.industry);
  if (ind) out.industry = ind;
  const tech = hit(vocab.tech);
  if (tech) out.tech = tech;
  const country = hit(vocab.country);
  if (country) out.country = country;
  const stage = hit(vocab.stage);
  if (stage) out.stage = stage;
  const skill = hit(vocab.skill);
  if (skill) out.skill = skill;
  return out;
}

/** NL search → structured directory filters ("find AI startups at seed"). The
 *  model (via the gateway) refines the deterministic heuristic when available. */
app.post("/sevan-query", async (req, res) => {
  const query = String(req.body?.query ?? "").trim();
  const vocab = (req.body?.vocab ?? {}) as SevanVocab;
  if (query.length < 2) return res.status(400).json({ error: "need a query" });
  const heuristic = sevanQueryHeuristic(query, vocab);
  const variant = variantForRequest(req, req.body);
  const useGateway = litellmConfigured();
  if (variant.provider === "heuristic" || (!useGateway && !anthropic)) {
    return res.json({ filters: heuristic, via: "heuristic" });
  }
  try {
    const system = `You turn an event-attendee's search into JSON filters for a startup-summit directory.
Return ONLY JSON: {"type": string|null, "industry": string|null, "tech": string|null, "country": string|null, "stage": string|null, "skill": string|null}.
Each value MUST be chosen from the allowed options (or null):
type: ${JSON.stringify(vocab.types ?? [])}
industry: ${JSON.stringify(vocab.industry ?? [])}
tech: ${JSON.stringify(vocab.tech ?? [])}
country: ${JSON.stringify(vocab.country ?? [])}
stage: ${JSON.stringify(vocab.stage ?? [])}
skill: ${JSON.stringify(vocab.skill ?? [])}`;
    let out = "";
    if (useGateway) {
      out = await gatewayChat({
        model: variant.model,
        system,
        user: query,
        json: true,
        meta: { userId: req.header("x-user-id") || undefined, variant: variant.key, source: variant.source, provider: variant.provider, endpoint: "sevan_query" },
      });
    } else {
      const msg = await anthropic!.messages.create({
        model: variant.model,
        max_tokens: 200,
        system,
        messages: [{ role: "user", content: query }],
      });
      out = msg.content[0]?.type === "text" ? msg.content[0].text : "";
    }
    const parsed = firstJsonObject(out) as Record<string, unknown>;
    const filters: SevanFilters = { ...heuristic };
    for (const k of ["type", "industry", "tech", "country", "stage", "skill"] as const) {
      const v = parsed[k];
      if (typeof v === "string" && v) filters[k] = v;
    }
    res.json({ filters, via: `model:${variant.model}` });
  } catch (e) {
    console.error("sevan-query model failed, heuristic only:", e);
    res.json({ filters: heuristic, via: "heuristic (model failed)" });
  }
});

/** Stream an agent-style answer over the search results (SSE tokens). */
app.post("/sevan-answer/stream", async (req, res) => {
  const query = String(req.body?.query ?? "").trim();
  const results = Array.isArray(req.body?.results) ? req.body.results.slice(0, 10) : [];
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.flushHeaders?.();
  const send = (payload: Record<string, unknown>) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

  const compact = results
    .map((r: Record<string, unknown>) =>
      `${r.label} (${r.entityType ?? "person"}${r.matchPct ? `, match ${r.matchPct}%` : ""})${r.reasons ? ` — ${(r.reasons as string[]).join(", ")}` : ""}${r.sub ? ` — ${r.sub}` : ""}`,
    )
    .join("\n");

  // The attendee's own profile — lets the concierge tailor relevance to who
  // they are (role, skills, sectors, their venture) without over-personalizing.
  const v = (req.body?.viewer ?? {}) as Record<string, unknown>;
  const viewerBits = [
    v.role && `a ${String(v.role).replace(/_/g, " ")}`,
    Array.isArray(v.sectors) && v.sectors.length && `in ${(v.sectors as string[]).slice(0, 2).join("/")}`,
    Array.isArray(v.skills) && v.skills.length && `skilled in ${(v.skills as string[]).slice(0, 3).join(", ")}`,
    v.venture && `building ${v.venture}`,
  ].filter(Boolean);
  const viewerLine = viewerBits.length ? `The attendee is ${viewerBits.join(", ")}.` : "";

  const fallback = async () => {
    // Deterministic concierge template, streamed in phrases for the agent feel.
    const top = results.slice(0, 3).map((r: Record<string, unknown>) => `**${r.label}**`).join(", ");
    const text =
      results.length === 0
        ? `I looked for “${query}” but nobody matches yet — try widening the filters, or ask your network for an intro.`
        : `Looking at “${query}” — I found ${results.length} match${results.length > 1 ? "es" : ""}. ` +
          `Top picks: ${top}. ` +
          (results[0]?.reasons ? `**${results[0].label}** stands out: ${(results[0].reasons as string[]).join(", ")}. ` : "") +
          `Open a card to save them or request a meeting.`;
    for (const chunk of text.match(/[^ ]+ ?/g) ?? []) {
      send({ type: "token", content: chunk });
      await new Promise((r) => setTimeout(r, 24));
    }
  };

  // mode "trust" = main-app trust-graph search; default = Sevan event directory.
  const mode = String(req.body?.mode ?? "sevan");
  const tailor = viewerLine
    ? "Lightly tailor relevance to who the user is when it genuinely helps — a light touch, at most one clause; never flatter or over-personalize. "
    : "";
  const variant = variantForRequest(req, req.body);
  const useGateway = litellmConfigured();
  try {
    if (variant.provider === "heuristic" || (!useGateway && !anthropic) || results.length === 0) {
      await fallback();
    } else {
      const system = mode === "trust"
        ? `You are the Trusty trust concierge. The user searched their trust graph for who their network trusts. In AT MOST 80 words, point them to the best people/providers BY NAME and why — lean on the trust reasons and how directly they're connected (direct vs. through the network). ${tailor}You MAY use light Markdown: **bold** for names and a short bullet list (\`- \`). Warm, candid, useful; end with a concrete next step ("I'll use this" / mark you trust them / ask your network).`
        : `You are the Trusty Sevan event concierge helping an attendee navigate the event directory. In AT MOST 80 words, conversationally point them to the best matches BY NAME and why (use the provided match reasons). ${tailor}You MAY use light Markdown: **bold** for names and a short bullet list (\`- \`) when several matches deserve equal billing. Keep it warm and useful, and end with a concrete next step (save a profile / request a meeting / ask for an intro).`;
      const user = `${viewerLine ? viewerLine + "\n" : ""}Search: "${query}"\nResults:\n${compact}`;
      if (useGateway) {
        await gatewayChat({
          model: variant.model,
          system,
          user,
          meta: { userId: req.header("x-user-id") || undefined, variant: variant.key, source: variant.source, provider: variant.provider, endpoint: "sevan_answer" },
          onToken: (t) => send({ type: "token", content: t }),
        });
      } else {
        const stream = anthropic!.messages.stream({
          model: variant.model,
          max_tokens: 220,
          system,
          messages: [{ role: "user", content: user }],
        });
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            send({ type: "token", content: event.delta.text });
          }
        }
      }
    }
  } catch (e) {
    console.error("sevan-answer model failed, falling back:", e);
    await fallback();
  }
  send({ type: "done" });
  res.end();
});

/** Resolve a natural-language search query into a structured trust scope (Doc §5). */
app.post("/resolve-scope", async (req, res) => {
  const q = String(req.body?.q ?? "").trim();
  if (q.length < 2) return res.status(400).json({ error: "need a query" });
  const variant = variantForRequest(req, req.body);
  try {
    const scope = await resolveScope(q, variant, {
      userId: req.header("x-user-id") || undefined,
      endpoint: "resolve_scope",
    });
    res.json({ ...scope, variant: variant.key });
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/* ── Composer agent (#29): model → tools → model, streamed as SSE ─────
 * Stateless: the client sends the full transcript each turn (plus `text` for a
 * new user turn, or `resume` after a confirm card) and stores the canonical
 * transcript returned in `done`. Tools run against graph-service with the
 * BFF-verified viewer identity. */
const AGENT_MODEL = process.env.AGENT_MODEL ?? "claude-sonnet-4-6";
const composerRegistry = buildComposerRegistry();

app.post("/agent/stream", async (req, res) => {
  if (!agentConfigured()) {
    return res.status(503).json({ error: "agent-unavailable" });
  }
  const userId = req.header("x-user-id");
  if (!userId) return res.status(401).json({ error: "missing user identity" });

  const b = req.body ?? {};
  const prior = Array.isArray(b.messages) ? (b.messages as AgentMessage[]) : [];
  const text = typeof b.text === "string" ? b.text.trim() : "";
  const mentions = Array.isArray(b.mentions)
    ? (b.mentions as ResolvedMention[]).slice(0, 24)
    : undefined;
  const resume =
    b.resume && typeof b.resume?.toolCallId === "string"
      ? (b.resume as AgentResume)
      : undefined;
  if (!text && !resume) return res.status(400).json({ error: "text or resume required" });

  // Manual model override (admin/debug) still works; A/B stays extraction-only —
  // the agent has its own default so a haiku extraction arm never dumbs it down.
  const variant = variantForRequest(req, b);
  const model =
    variant.source === "override" && variant.provider === "claude" ? variant.model : AGENT_MODEL;

  const transcript: AgentMessage[] = [...prior];
  if (text) {
    const context = buildContextBlock({
      viewerId: userId,
      viewerName: req.header("x-user-name") || undefined,
      mentions,
      text,
    });
    transcript.push({ role: "user", content: `${text}\n\n${context}` });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  const emit = (payload: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  try {
    const result = await runAgentLoop({
      transcript,
      system: AGENT_SYSTEM_PROMPT,
      registry: composerRegistry,
      ctx: { userId, graphUrl: GRAPH, emit: emit as (ev: AgentStreamEvent) => void },
      model,
      meta: {
        userId,
        variant: model,
        source: variant.source === "override" ? "override" : "default",
        provider: "claude",
        endpoint: "agent",
        sessionId: typeof b.sessionId === "string" ? b.sessionId : undefined,
      },
      emit: emit as (ev: AgentStreamEvent) => void,
      resume,
    });
    emit({
      type: "done",
      transcript: result.transcript,
      variant: model,
      turns: result.turns,
      suspended: result.suspended,
    });
    res.end();
  } catch (e) {
    emit({ type: "error", message: e instanceof Error ? e.message : String(e) });
    res.end();
  }
});

app.listen(PORT, () => {
  const r = describeRouter(effectiveConfig());
  console.log(
    `extractor listening on :${PORT} — default=${r.default}, ` +
      `ab=${r.abTest}, override=${r.overrideAllowed ? "on" : "off"} ` +
      `(ollama=${r.providers.ollama}, claude=${r.providers.claude})`,
  );
});
