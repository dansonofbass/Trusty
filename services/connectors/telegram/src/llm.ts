/**
 * Optional LLM refinement — runs ONLY on candidates the heuristics already
 * accepted, never on the raw firehose.
 *
 * Why this order: the heuristics drop ~60% of a public group as advertising for
 * free, so paying a model to read that is pure waste. What a model is actually
 * good at is the last mile — turning a member's rushed reply into a clean answer,
 * and coding a rejection reason. Everything it writes still goes to review.
 *
 * Privacy rule: we send message TEXT, never author names, ids or phone numbers.
 * The prompt asks for a rewrite in the community's own register, and forbids
 * inventing specifics that are not in the source.
 */
import type { OutcomeCandidate, QaCandidate } from "./types";

const LITELLM = process.env.LITELLM_BASE_URL ?? "";
const KEY = process.env.LITELLM_API_KEY ?? "";
const MODEL = process.env.TELEGRAM_EXTRACT_MODEL ?? "claude-sonnet-5";

export const llmConfigured = (): boolean => Boolean(LITELLM);

const SYSTEM = `You clean up community knowledge for a Persian-first help forum used by Iranians relocating to Armenia.

You will receive a question and the reply it received, both copied verbatim from a Telegram group.

Rewrite them into a publishable question and answer.

Rules, in order of importance:
1. NEVER invent a fact. Every number, fee, deadline, office name and form number in your answer must appear in the source text. If the source has no specific, say so in "note" and leave the answer close to the original.
2. Keep the community's own register — plain, direct Persian. Do not make it corporate.
3. Strip greetings, thanks, @handles, phone numbers and names of private individuals.
4. Keep the answer under 200 words. Lead with the direct answer in the first sentence.
5. If the reply contradicts itself or is too vague to be useful, set "usable": false.

Return ONLY a JSON object:
{"usable":true|false,"title":"…","answer":"…","tags":["…"],"note":"…"}`;

interface Refined {
  usable: boolean;
  title?: string;
  answer?: string;
  tags?: string[];
  note?: string;
}

async function chat(system: string, user: string): Promise<string> {
  const r = await fetch(`${LITELLM.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(KEY ? { authorization: `Bearer ${KEY}` } : {}),
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0,
      response_format: { type: "json_object" },
      metadata: { generation_name: "telegram-extract", tags: ["connector-telegram"] },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) throw new Error(`litellm ${r.status}: ${(await r.text()).slice(0, 160)}`);
  const body = (await r.json()) as { choices?: { message?: { content?: string } }[] };
  return body.choices?.[0]?.message?.content ?? "";
}

/**
 * Refine one Q&A candidate. On any failure the ORIGINAL candidate is returned
 * unchanged — a flaky model must never silently drop knowledge.
 */
export async function refineQa(c: QaCandidate): Promise<QaCandidate> {
  if (!llmConfigured()) return c;
  try {
    const raw = await chat(
      SYSTEM,
      `QUESTION:\n${c.title}\n${c.body}\n\nREPLY:\n${c.answer}`,
    );
    const parsed = JSON.parse(raw) as Refined;
    if (!parsed.usable || !parsed.answer) {
      return { ...c, confidence: Math.min(c.confidence, 0.35), stage: "llm-rejected" };
    }
    return {
      ...c,
      title: (parsed.title ?? c.title).slice(0, 180),
      answer: parsed.answer.slice(0, 4000),
      tags: (parsed.tags ?? c.tags).slice(0, 4),
      stage: "llm",
      // A model rewrite is a claim about the source, not a new source. Cap it
      // below the auto-publish line so a human always sees it.
      confidence: Math.min(0.85, c.confidence + 0.1),
    };
  } catch {
    return c;
  }
}

const OUTCOME_SYSTEM = `Code one Telegram message into a structured outcome about a bureaucratic step in Armenia.
Return ONLY JSON: {"confident":true|false,"result":"approved|rejected|pending|abandoned","reasonCode":"documents|income_proof|nationality|risk|no_reason|other","costAmd":number|null,"durationDays":number|null}
Set "confident": false if the message is about someone else's case, is hearsay, or is a question rather than a report.`;

export async function refineOutcome(c: OutcomeCandidate, text: string): Promise<OutcomeCandidate> {
  if (!llmConfigured()) return c;
  try {
    const parsed = JSON.parse(await chat(OUTCOME_SYSTEM, text)) as {
      confident: boolean;
      result?: OutcomeCandidate["result"];
      reasonCode?: string;
      costAmd?: number | null;
      durationDays?: number | null;
    };
    if (!parsed.confident) return { ...c, confidence: 0.3, stage: "llm-rejected" };
    return {
      ...c,
      result: parsed.result ?? c.result,
      reasonCode: parsed.reasonCode ?? c.reasonCode,
      costAmd: parsed.costAmd ?? c.costAmd,
      durationDays: parsed.durationDays ?? c.durationDays,
      stage: "llm",
      confidence: Math.min(0.85, c.confidence + 0.15),
    };
  } catch {
    return c;
  }
}
