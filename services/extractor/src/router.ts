/**
 * Extraction model routing — decides which provider + model handles a request.
 *
 * The extractor can extract via three providers:
 *   • ollama    — a local LLM (LangExtract-style), free + private
 *   • claude    — the Claude Messages API (e.g. Haiku), hosted + higher quality
 *   • heuristic — deterministic offline fallback
 *
 * Rather than pinning one provider at boot, the router resolves a {@link ResolvedVariant}
 * per request from three layers (first match wins):
 *
 *   1. Manual override   — an explicit `x-extractor-model` / `x-extractor-provider`
 *      header or `{ model, provider }` body field. Lets an operator (or a UI
 *      model-picker) force a specific model. Gated by EXTRACTOR_ALLOW_OVERRIDE.
 *   2. A/B experiment    — EXTRACTOR_AB_TEST splits users across variants by a
 *      stable hash of their user id, so each user sticks to one arm and the
 *      split is reproducible.
 *   3. Default           — EXTRACTOR_PROVIDER, else the legacy auto precedence
 *      (ollama → claude → heuristic) based on what's configured.
 *
 * Every resolution is validated against what's actually available (API key /
 * ollama host present); an unavailable choice degrades gracefully rather than
 * erroring, and the chosen variant + its `source` are reported back so A/B
 * outcomes can be measured downstream.
 */

export type ProviderKind = "ollama" | "claude" | "heuristic";

export type VariantSource = "override" | "ab-test" | "default" | "fallback";

/** A concrete, ready-to-run extraction choice. */
export interface ResolvedVariant {
  /** Stable label for analytics/logging, e.g. "claude-haiku-4-5" | "ollama" | "heuristic". */
  key: string;
  provider: ProviderKind;
  /** Concrete model id (Claude model id or Ollama model tag); "none" for heuristic. */
  model: string;
  /** Which routing layer produced this choice. */
  source: VariantSource;
}

/** One arm of an A/B experiment. */
export interface AbBucket {
  key: string;
  weight: number;
}

export interface RouterConfig {
  ollamaConfigured: boolean;
  claudeConfigured: boolean;
  ollamaModel: string;
  defaultClaudeModel: string;
  /** Variant key chosen when no override/experiment applies. */
  defaultKey: string;
  abBuckets: AbBucket[];
  abSalt: string;
  allowOverride: boolean;
}

export interface RouterInputs {
  userId?: string;
  /** From `x-extractor-model` header or `model` body field. */
  overrideModel?: string;
  /** From `x-extractor-provider` header or `provider` body field. */
  overrideProvider?: string;
}

/* ------------------------------------------------------------------ */
/* Parsing env into a RouterConfig                                     */
/* ------------------------------------------------------------------ */

const truthy = (v: string | undefined) =>
  v === "1" || v?.toLowerCase() === "true" || v?.toLowerCase() === "yes";

/**
 * Parse `EXTRACTOR_AB_TEST` — `key=weight,key=weight` (weights optional, default 1).
 * Examples:
 *   "claude=50,ollama=50"                         — Claude vs local, even split
 *   "claude-haiku-4-5=50,claude-sonnet-4-6=50"    — two Claude models head-to-head
 * Invalid / empty input yields no buckets (A/B disabled).
 */
export function parseAbConfig(raw: string | undefined): AbBucket[] {
  if (!raw?.trim()) return [];
  const buckets: AbBucket[] = [];
  for (const part of raw.split(",")) {
    const [keyRaw, weightRaw] = part.split("=");
    const key = keyRaw?.trim();
    if (!key) continue;
    const weight = weightRaw === undefined ? 1 : Number(weightRaw.trim());
    if (!Number.isFinite(weight) || weight <= 0) continue;
    buckets.push({ key, weight });
  }
  return buckets;
}

/**
 * Decide the default variant key when nothing overrides it. An explicit
 * EXTRACTOR_PROVIDER wins; otherwise fall back to the legacy auto precedence
 * (ollama → claude → heuristic) based on what's configured.
 */
function resolveDefaultKey(
  explicit: string | undefined,
  ollamaConfigured: boolean,
  claudeConfigured: boolean,
): string {
  const e = explicit?.trim();
  if (e) return e;
  if (ollamaConfigured) return "ollama";
  if (claudeConfigured) return "claude";
  return "heuristic";
}

export function buildRouterConfig(env: NodeJS.ProcessEnv): RouterConfig {
  const ollamaConfigured = Boolean(env.OLLAMA_HOST) || env.USE_OLLAMA === "1";
  const claudeConfigured = Boolean(env.ANTHROPIC_API_KEY);
  const ollamaModel = env.OLLAMA_MODEL ?? "gemma3:latest";
  const defaultClaudeModel = env.EXTRACTOR_MODEL ?? "claude-haiku-4-5";

  return {
    ollamaConfigured,
    claudeConfigured,
    ollamaModel,
    defaultClaudeModel,
    defaultKey: resolveDefaultKey(env.EXTRACTOR_PROVIDER, ollamaConfigured, claudeConfigured),
    abBuckets: parseAbConfig(env.EXTRACTOR_AB_TEST),
    abSalt: env.EXTRACTOR_AB_SALT ?? "constellation",
    // Overrides are allowed by default; set EXTRACTOR_ALLOW_OVERRIDE=0 to lock the model.
    allowOverride: env.EXTRACTOR_ALLOW_OVERRIDE === undefined
      ? true
      : truthy(env.EXTRACTOR_ALLOW_OVERRIDE),
  };
}

/* ------------------------------------------------------------------ */
/* Variant key → concrete provider + model                            */
/* ------------------------------------------------------------------ */

/**
 * Turn a variant key into a provider + model (without availability checks).
 * Accepted keys:
 *   "heuristic"
 *   "ollama"            → ollama with the configured default model
 *   "ollama:<tag>"      → ollama with an explicit model tag
 *   "claude"            → claude with the configured default model
 *   "claude:<id>"       → claude with an explicit model id
 *   "claude-<...>"      → claude with that model id (bare model id shorthand)
 */
export function materializeKey(
  key: string,
  cfg: RouterConfig,
): { provider: ProviderKind; model: string; key: string } {
  const k = key.trim();
  const lower = k.toLowerCase();

  if (lower === "heuristic") return { provider: "heuristic", model: "none", key: "heuristic" };

  if (lower === "ollama") {
    return { provider: "ollama", model: cfg.ollamaModel, key: "ollama" };
  }
  if (lower.startsWith("ollama:")) {
    const model = k.slice("ollama:".length).trim() || cfg.ollamaModel;
    return { provider: "ollama", model, key: `ollama:${model}` };
  }

  if (lower === "claude") {
    return { provider: "claude", model: cfg.defaultClaudeModel, key: cfg.defaultClaudeModel };
  }
  if (lower.startsWith("claude:")) {
    const model = k.slice("claude:".length).trim() || cfg.defaultClaudeModel;
    return { provider: "claude", model, key: model };
  }
  // Bare Claude model id (e.g. "claude-haiku-4-5").
  if (lower.startsWith("claude-")) {
    return { provider: "claude", model: k, key: k };
  }

  // Unknown key — treat as a Claude model id (the API surfaces a clear 404 if wrong).
  return { provider: "claude", model: k, key: k };
}

/** Is this provider actually usable given what's configured? */
function isAvailable(provider: ProviderKind, cfg: RouterConfig): boolean {
  if (provider === "claude") return cfg.claudeConfigured;
  if (provider === "ollama") return cfg.ollamaConfigured;
  return true; // heuristic always available
}

/** The safe fallback when a requested variant isn't available. */
function fallbackVariant(cfg: RouterConfig): { provider: ProviderKind; model: string; key: string } {
  const def = materializeKey(cfg.defaultKey, cfg);
  if (isAvailable(def.provider, cfg)) return def;
  if (cfg.claudeConfigured) return materializeKey("claude", cfg);
  if (cfg.ollamaConfigured) return materializeKey("ollama", cfg);
  return materializeKey("heuristic", cfg);
}

/* ------------------------------------------------------------------ */
/* Sticky per-user A/B assignment                                     */
/* ------------------------------------------------------------------ */

/** djb2 — small, fast, stable string hash (good enough for bucketing). */
function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h + s.charCodeAt(i)) >>> 0);
  return h >>> 0;
}

/**
 * Deterministically pick an A/B bucket for a user. The same user + salt always
 * lands in the same arm (sticky), so experiment exposure is stable across
 * requests and reproducible.
 */
export function pickAbBucket(userId: string, buckets: AbBucket[], salt: string): string | null {
  if (buckets.length === 0) return null;
  const total = buckets.reduce((sum, b) => sum + b.weight, 0);
  if (total <= 0) return null;
  let point = djb2(`${salt}:${userId}`) % total;
  for (const b of buckets) {
    if (point < b.weight) return b.key;
    point -= b.weight;
  }
  return buckets[buckets.length - 1].key; // unreachable, but typesafe
}

/* ------------------------------------------------------------------ */
/* The resolver                                                        */
/* ------------------------------------------------------------------ */

/**
 * Resolve the variant for a single request, applying override → A/B → default,
 * then validating availability (degrading to a safe fallback if needed).
 */
export function resolveVariant(cfg: RouterConfig, inputs: RouterInputs): ResolvedVariant {
  const finalize = (
    chosen: { provider: ProviderKind; model: string; key: string },
    source: VariantSource,
  ): ResolvedVariant => {
    if (isAvailable(chosen.provider, cfg)) {
      return { key: chosen.key, provider: chosen.provider, model: chosen.model, source };
    }
    const fb = fallbackVariant(cfg);
    return { key: fb.key, provider: fb.provider, model: fb.model, source: "fallback" };
  };

  // 1. Manual override (header / body).
  if (cfg.allowOverride && (inputs.overrideModel || inputs.overrideProvider)) {
    const provider = inputs.overrideProvider?.trim().toLowerCase();
    const model = inputs.overrideModel?.trim();
    let key: string;
    if (provider === "heuristic") key = "heuristic";
    else if (provider === "ollama") key = model ? `ollama:${model}` : "ollama";
    else if (provider === "claude") key = model ? `claude:${model}` : "claude";
    else key = model ?? "claude"; // model-only override
    return finalize(materializeKey(key, cfg), "override");
  }

  // 2. A/B experiment (sticky per user).
  if (inputs.userId) {
    const bucket = pickAbBucket(inputs.userId, cfg.abBuckets, cfg.abSalt);
    if (bucket) return finalize(materializeKey(bucket, cfg), "ab-test");
  }

  // 3. Default.
  return finalize(materializeKey(cfg.defaultKey, cfg), "default");
}

/* ------------------------------------------------------------------ */
/* Runtime overrides (set by the admin panel, layered over env)        */
/* ------------------------------------------------------------------ */

/**
 * Admin-settable overrides, layered on top of the env-derived base config.
 * Any field left undefined falls through to the env default; an empty string
 * means "clear this override / use the env default" (and for `abTest`, "disable").
 */
export interface RoutingOverrides {
  defaultKey?: string;
  abTest?: string;
  abSalt?: string;
  allowOverride?: boolean;
  /** Plan tier → model id ("free" → cheap/fast, "premium" → strong). Applied
   *  before the A/B experiment and the global default. */
  tierModels?: Record<string, string>;
}

/** Merge admin overrides over the env-derived base into an effective config. */
export function applyOverrides(
  base: RouterConfig,
  o: RoutingOverrides | null | undefined,
): RouterConfig {
  if (!o) return base;
  return {
    ...base,
    defaultKey: o.defaultKey?.trim() || base.defaultKey,
    abBuckets: o.abTest !== undefined ? parseAbConfig(o.abTest) : base.abBuckets,
    abSalt: o.abSalt?.trim() || base.abSalt,
    allowOverride: o.allowOverride !== undefined ? o.allowOverride : base.allowOverride,
  };
}

/**
 * Validate a variant key against what's configured — used by the admin panel so
 * an operator can't pin the default (or an A/B arm) to an unavailable provider.
 */
export function variantKeyAvailable(
  key: string,
  cfg: RouterConfig,
): { ok: boolean; provider: ProviderKind; model: string; reason?: string } {
  const m = materializeKey(key, cfg);
  if (m.provider === "claude" && !cfg.claudeConfigured) {
    return { ok: false, provider: m.provider, model: m.model, reason: "Claude not configured (set ANTHROPIC_API_KEY)" };
  }
  if (m.provider === "ollama" && !cfg.ollamaConfigured) {
    return { ok: false, provider: m.provider, model: m.model, reason: "Ollama not configured (set OLLAMA_HOST)" };
  }
  return { ok: true, provider: m.provider, model: m.model };
}

/** A compact description of the router for /health. */
export function describeRouter(cfg: RouterConfig) {
  return {
    default: cfg.defaultKey,
    abTest: cfg.abBuckets.length
      ? cfg.abBuckets.map((b) => `${b.key}:${b.weight}`).join(",")
      : "disabled",
    overrideAllowed: cfg.allowOverride,
    providers: {
      ollama: cfg.ollamaConfigured ? cfg.ollamaModel : "unconfigured",
      claude: cfg.claudeConfigured ? cfg.defaultClaudeModel : "unconfigured",
      heuristic: "always",
    },
  };
}
