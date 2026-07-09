/**
 * LiteLLM gateway client.
 *
 * When LITELLM_BASE_URL is set, model calls are routed through the self-hosted
 * LiteLLM proxy (OpenAI-compatible `/chat/completions`) instead of hitting the
 * providers directly. LiteLLM unifies cost accounting across models and streams
 * a trace of every call (input, output, tokens, cost) to Langfuse for
 * monitoring + later evaluation/labelling.
 *
 * Each call carries metadata — the A/B variant, how it was chosen, the provider,
 * the calling endpoint, and the user id — which LiteLLM forwards to Langfuse as
 * trace tags/metadata, so experiments are sliceable per arm and per user.
 */
const LITELLM_BASE_URL = process.env.LITELLM_BASE_URL?.replace(/\/+$/, "");
const LITELLM_MASTER_KEY = process.env.LITELLM_MASTER_KEY ?? "";

/** True when the gateway is configured (otherwise callers use the direct path). */
export const litellmConfigured = (): boolean => Boolean(LITELLM_BASE_URL);

/** Trace tagging — ties a generation to its A/B arm + the user behind it. */
export interface GatewayCallMeta {
  userId?: string;
  variant: string;
  source: string;
  provider: string;
  endpoint: string;
  sessionId?: string;
}

export interface GatewayChatOpts {
  model: string;
  system: string;
  user: string;
  /** Ask for a strict JSON object (Ollama json mode / structured output). */
  json?: boolean;
  meta: GatewayCallMeta;
  onToken?: (token: string) => void;
}

/**
 * Stream a chat completion through LiteLLM and return the full text. LiteLLM
 * records cost + the full I/O to Langfuse via its success callback; we only need
 * the assembled text here (parsing happens in the caller).
 */
export async function gatewayChat(opts: GatewayChatOpts): Promise<string> {
  if (!LITELLM_BASE_URL) throw new Error("LITELLM_BASE_URL not configured");

  const body: Record<string, unknown> = {
    model: opts.model,
    stream: true,
    stream_options: { include_usage: true },
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
    // LiteLLM → Langfuse trace metadata (sliceable per A/B arm + user).
    metadata: {
      generation_name: `extract:${opts.meta.endpoint}`,
      trace_name: `extract:${opts.meta.endpoint}`,
      trace_user_id: opts.meta.userId || "anonymous",
      ...(opts.meta.sessionId ? { session_id: opts.meta.sessionId } : {}),
      tags: [
        `variant:${opts.meta.variant}`,
        `source:${opts.meta.source}`,
        `provider:${opts.meta.provider}`,
      ],
      trace_metadata: {
        variant: opts.meta.variant,
        variantSource: opts.meta.source,
        provider: opts.meta.provider,
        endpoint: opts.meta.endpoint,
      },
    },
  };
  if (opts.json) body.response_format = { type: "json_object" };

  const r = await fetch(`${LITELLM_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${LITELLM_MASTER_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    throw new Error(`litellm responded ${r.status}: ${await r.text().catch(() => "")}`);
  }

  const reader = r.body?.getReader();
  if (!reader) throw new Error("litellm returned no stream body");
  const dec = new TextDecoder();
  let buf = "";
  let out = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const data = t.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const chunk = JSON.parse(data) as {
          choices?: { delta?: { content?: string } }[];
        };
        const piece = chunk.choices?.[0]?.delta?.content ?? "";
        if (piece) {
          out += piece;
          opts.onToken?.(piece);
        }
      } catch {
        /* ignore partial lines */
      }
    }
  }

  return out;
}
