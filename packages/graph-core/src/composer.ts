/**
 * Unified AI Composer — intent detection (#29).
 *
 * One composer, no modes: the user types naturally and the system decides
 * whether they are searching, recommending, capturing an experience, noting a
 * decision, or just thinking. The spec's frozen properties:
 *
 *  - **Continuous** — classification runs while typing (this function is pure
 *    and cheap, so the client calls it on every keystroke; an LLM pass can
 *    refine it later without changing the contract).
 *  - **Mixed intent** — a message may carry several intentions; sentences are
 *    classified independently and the analysis reports every one, so the
 *    backend can route each part without forcing the user to split text.
 *  - **Natural language first** — no syntax required; @/#/[[ ]] mentions are
 *    optional accelerators handled by the editor, not here.
 *  - **Private by default** — nothing here publishes anything; the analysis
 *    only informs which affordances the composer offers.
 *
 * Deterministic + testable; no I/O, no clock.
 */

import { TOPIC_TAXONOMY } from "./trust";

export type ComposerIntent =
  | "search"
  | "question"
  | "recommendation"
  | "experience"
  | "decision_update"
  | "note"
  | "unknown";

export interface IntentGuess {
  intent: ComposerIntent;
  /** 0..1 — heuristic confidence. */
  confidence: number;
  /** The sentence this guess is about (mixed-intent support). */
  sentence: string;
  /** Sentence position in the input. */
  index: number;
}

export interface ComposerAnalysis {
  /** Highest-confidence intent across sentences. */
  primary: ComposerIntent;
  confidence: number;
  /** One guess per sentence — ≥2 distinct confident intents ⇒ mixed. */
  intents: IntentGuess[];
  mixed: boolean;
  /** Taxonomy topics found anywhere in the text. */
  topics: string[];
}

/* Ordered rule table — first match wins per sentence. Confidence reflects how
 * unambiguous the cue is. Kept as data so future rules (or an LLM reranker)
 * slot in without redesign. */
const RULES: { intent: ComposerIntent; confidence: number; re: RegExp }[] = [
  { intent: "note", confidence: 0.9, re: /^\s*(note|remember|reminder|todo|don'?t forget)\b/i },
  { intent: "decision_update", confidence: 0.85, re: /\bi\s+(finally\s+)?(decided|chose|picked|went with|signed with|selected|ended up)\b/i },
  { intent: "recommendation", confidence: 0.9, re: /\b(i|we)\s+(highly\s+)?recommend\b|\bhighly recommended?\b|\byou should (try|see|visit|use)\b|\bworth (trying|visiting|every penny)\b/i },
  { intent: "experience", confidence: 0.8, re: /\b(had|have had)\s+(a|an)\s+\w*\s*(experience|time)\b|\bi\s+(visited|hired|used|tried|went to|worked with|ate at|stayed at)\b/i },
  { intent: "search", confidence: 0.9, re: /\b(i\s+)?(need|need to find|am looking for|looking for|searching for|trying to find|can (anyone|you) (recommend|suggest)|recommend me|suggest me|find me|help me find)\b/i },
  { intent: "search", confidence: 0.8, re: /^\s*(who|where|which|what)\b.*\b(good|best|recommend|trust|reliable|find)\b/i },
  { intent: "question", confidence: 0.7, re: /\?\s*$/ },
];

const SENTENCE_SPLIT = /(?<=[.!?])\s+|\n+/;

/** Taxonomy topics literally present in the text ("real_estate" matches "real estate"). */
export function topicsInText(text: string): string[] {
  const lower = ` ${text.toLowerCase()} `;
  return TOPIC_TAXONOMY.filter((t) => lower.includes(t.replace(/_/g, " ")));
}

function classifySentence(sentence: string, index: number): IntentGuess {
  const s = sentence.trim();
  if (!s) return { intent: "unknown", confidence: 0, sentence: s, index };
  for (const rule of RULES) {
    if (rule.re.test(s)) return { intent: rule.intent, confidence: rule.confidence, sentence: s, index };
  }
  // Default: private capture. Everything is a note until it earns a stronger
  // reading — the workspace is the safe landing zone (#31 private-by-default).
  return { intent: "note", confidence: 0.35, sentence: s, index };
}

/** Analyze composer text — pure, incremental-friendly, sentence-aware. */
export function analyzeComposerText(text: string): ComposerAnalysis {
  const trimmed = text.trim();
  if (!trimmed) return { primary: "unknown", confidence: 0, intents: [], mixed: false, topics: [] };

  const sentences = trimmed.split(SENTENCE_SPLIT).filter((s) => s.trim().length > 0);
  const intents = sentences.map((s, i) => classifySentence(s, i));

  // A trailing "?" upgrades an otherwise-plain note to a question/search.
  const best = [...intents].sort((a, b) => b.confidence - a.confidence)[0];
  const confident = new Set(intents.filter((g) => g.confidence >= 0.5).map((g) => g.intent));

  return {
    primary: best.intent,
    confidence: best.confidence,
    intents,
    mixed: confident.size >= 2,
    topics: topicsInText(trimmed),
  };
}
