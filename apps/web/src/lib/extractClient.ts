/**
 * Streaming extraction client — SSE from the extractor service.
 */
import type { Dataset, NotePrivacy, ThoughtExtraction } from "@constellation/graph-core";
import type { TrustAssertion } from "./trustClient";

// Same-origin BFF proxies (authenticated + forwarded to the internal extractor).
const EXTRACT_STREAM_URL = "/api/extract/stream";
const INGEST_URL = "/api/ingest";

export type ExtractPhase =
  | "prepare"
  | "llm"
  | "parse"
  | "sources"
  | "trust"
  | "done";

export type ExtractStreamEvent =
  | { type: "phase"; phase: ExtractPhase; label: string; progress: number }
  | { type: "token"; content: string }
  | { type: "source"; entity: string; resolved: boolean }
  | { type: "trust"; assertions: TrustAssertion[] }
  | ({ type: "privacy" } & NotePrivacy)
  | {
      type: "done";
      via: string;
      /** Routing variant key chosen for this request (e.g. "claude-haiku-4-5", "ollama"). */
      variant?: string;
      /** How the variant was chosen: override | ab-test | default | fallback. */
      variantSource?: string;
      extraction: ThoughtExtraction;
      rawModelOutput?: string;
      /** AI-proposed trust edges — confirmed by the user before weaving. */
      trustAssertions?: TrustAssertion[];
      /** Summit notes: "is this safe to post publicly?" assessment. */
      privacy?: NotePrivacy;
    }
  | { type: "error"; message: string };

export interface ExtractStreamHandlers {
  onEvent?: (event: ExtractStreamEvent) => void;
}

function parseSseBlock(block: string): ExtractStreamEvent | null {
  const dataLine = block.split("\n").find((l) => l.startsWith("data: "));
  if (!dataLine) return null;
  try {
    return JSON.parse(dataLine.slice(6)) as ExtractStreamEvent;
  } catch {
    return null;
  }
}

/** Stream an extraction with live LLM tokens and phase updates.
 *  `domain: "summit"` selects the Trusty Sevan meeting-note taxonomy. */
export async function streamExtract(
  text: string,
  handlers: ExtractStreamHandlers = {},
  opts: { domain?: string; kinds?: string[] } = {},
): Promise<{ via: string; extraction: ThoughtExtraction; rawModelOutput?: string; trustAssertions: TrustAssertion[]; privacy?: NotePrivacy }> {
  const r = await fetch(EXTRACT_STREAM_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      text,
      ...(opts.domain ? { domain: opts.domain } : {}),
      ...(opts.kinds?.length ? { kinds: opts.kinds } : {}),
    }),
  });
  if (!r.ok) {
    const body = (await r.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `extractor stream ${r.status}`);
  }
  if (!r.body) throw new Error("extractor returned no stream body");

  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let result:
    | { via: string; extraction: ThoughtExtraction; rawModelOutput?: string; trustAssertions: TrustAssertion[]; privacy?: NotePrivacy }
    | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const part of parts) {
      const ev = parseSseBlock(part);
      if (!ev) continue;
      handlers.onEvent?.(ev);
      if (ev.type === "done") {
        result = {
          via: ev.via,
          extraction: ev.extraction,
          rawModelOutput: ev.rawModelOutput,
          trustAssertions: ev.trustAssertions ?? [],
          privacy: ev.privacy,
        };
      }
      if (ev.type === "error") throw new Error(ev.message);
    }
  }

  if (!result) throw new Error("extraction stream ended without result");
  return result;
}

/** Push a pre-computed extraction into the graph (skips re-extraction).
 *  `originalExtraction` is the model's pre-edit version, logged for edit history. */
export async function ingestExtraction(
  authorId: string,
  text: string,
  extraction: ThoughtExtraction,
  originalExtraction?: ThoughtExtraction,
  writingId?: string,
  /** User-confirmed trust suggestions to write alongside the thought. */
  trustAssertions?: TrustAssertion[],
): Promise<{
  dataset: Dataset;
  thoughtId: string;
  conceptIds: string[];
}> {
  const r = await fetch(INGEST_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ authorId, text, extraction, originalExtraction, writingId, trustAssertions }),
  });
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error((body as { error?: string })?.error ?? `extractor ${r.status}`);
  const ing = (body as { _ingested?: { thoughtId: string; conceptIds: string[] } })._ingested;
  return {
    dataset: body as Dataset,
    thoughtId: ing?.thoughtId ?? "",
    conceptIds: ing?.conceptIds ?? [],
  };
}
