/**
 * Model catalog + cost accounting.
 *
 * Prices come from LiteLLM's own `/model/info` (the same numbers it bills and
 * ships to Langfuse), so the admin panel can never drift from what we actually
 * pay. We add the human layer on top — a label, what each model is good for,
 * and a speed hint — because a price table alone doesn't help someone choose.
 *
 * Cached for a few minutes: this feeds an admin screen, not a hot path.
 */

const LITELLM_URL = (process.env.LITELLM_URL ?? "http://litellm:4000").replace(/\/+$/, "");
const LITELLM_KEY = process.env.LITELLM_MASTER_KEY ?? "";

export interface ModelInfo {
  id: string;
  label: string;
  /** One line: when to pick this one. */
  blurb: string;
  /** USD per 1M tokens. */
  inputPer1M: number;
  outputPer1M: number;
  /** Rough relative speed/quality hints for the comparison table. */
  speed: "fastest" | "fast" | "balanced" | "deep";
  available: boolean;
}

/** The human layer — extend when a model is added to the LiteLLM config. */
const DESCRIPTIONS: Record<string, { label: string; blurb: string; speed: ModelInfo["speed"] }> = {
  "claude-haiku-4-5": {
    label: "Claude Haiku 4.5",
    blurb: "Fastest and cheapest — great for extraction, tagging and everyday chat.",
    speed: "fastest",
  },
  "claude-sonnet-4-6": {
    label: "Claude Sonnet 4.6",
    blurb: "The balanced default — strong reasoning and tool use at a moderate price.",
    speed: "balanced",
  },
  "claude-opus-4-8": {
    label: "Claude Opus 4.8",
    blurb: "Deepest reasoning for hard, high-stakes answers. Costs the most.",
    speed: "deep",
  },
};

const prettify = (id: string) =>
  id.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

let cache: { at: number; models: ModelInfo[] } | null = null;
const TTL_MS = 5 * 60_000;

/** Live catalog: LiteLLM's models + prices, enriched with descriptions. */
export async function modelCatalog(force = false): Promise<ModelInfo[]> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.models;
  let models: ModelInfo[] = [];
  try {
    const r = await fetch(`${LITELLM_URL}/model/info`, {
      headers: LITELLM_KEY ? { authorization: `Bearer ${LITELLM_KEY}` } : undefined,
    });
    if (r.ok) {
      const body = (await r.json()) as {
        data?: {
          model_name?: string;
          model_info?: { input_cost_per_token?: number; output_cost_per_token?: number };
        }[];
      };
      models = (body.data ?? [])
        .filter((m) => m.model_name)
        .map((m) => {
          const id = String(m.model_name);
          const d = DESCRIPTIONS[id];
          return {
            id,
            label: d?.label ?? prettify(id),
            blurb: d?.blurb ?? "",
            speed: d?.speed ?? "balanced",
            inputPer1M: Number(m.model_info?.input_cost_per_token ?? 0) * 1_000_000,
            outputPer1M: Number(m.model_info?.output_cost_per_token ?? 0) * 1_000_000,
            available: true,
          };
        });
    }
  } catch {
    /* LiteLLM down — fall through to the described set so the UI still renders */
  }
  if (!models.length) {
    models = Object.entries(DESCRIPTIONS).map(([id, d]) => ({
      id,
      label: d.label,
      blurb: d.blurb,
      speed: d.speed,
      inputPer1M: 0,
      outputPer1M: 0,
      available: false,
    }));
  }
  models.sort((a, b) => a.inputPer1M - b.inputPer1M);
  cache = { at: Date.now(), models };
  return models;
}

/** USD cost of one call, from the live price table. */
export async function costOf(model: string, promptTokens: number, completionTokens: number): Promise<number> {
  const m = (await modelCatalog()).find((x) => x.id === model);
  if (!m) return 0;
  return (promptTokens / 1e6) * m.inputPer1M + (completionTokens / 1e6) * m.outputPer1M;
}

/* ------------------------------------------------------------------ */
/* Usage reporting — one line per LLM call, stored by graph-service     */
/* ------------------------------------------------------------------ */

const GRAPH = (process.env.GRAPH_SERVICE_URL ?? "http://graph-service:4001").replace(/\/+$/, "");

export interface UsageReport {
  userId?: string;
  model: string;
  provider: string;
  endpoint: string;
  promptTokens: number;
  completionTokens: number;
  tier?: string;
}

/**
 * Report token usage + computed cost. Fire-and-forget: accounting must never
 * slow down or break a user's turn.
 */
export function reportUsage(u: UsageReport): void {
  void (async () => {
    try {
      if (!u.promptTokens && !u.completionTokens) return;
      const costUsd = await costOf(u.model, u.promptTokens, u.completionTokens);
      await fetch(`${GRAPH}/api/internal/llm-usage`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-user-id": u.userId || "system",
          "x-internal": "extractor",
        },
        body: JSON.stringify({ ...u, costUsd }),
      });
    } catch {
      /* never propagate */
    }
  })();
}
