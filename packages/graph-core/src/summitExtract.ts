/**
 * Trusty Sevan meeting-note extraction — the summit taxonomy variants of the
 * extraction prompts. A meeting note ("Met Ana — building fintech for Armenia,
 * needs a React dev and seed funding") becomes entities of networking kinds
 * (need · technology · investor · api · mentor · skill · idea · market ·
 * startup · country · person · organization) that turn into graph connections.
 *
 * The MAIN app's knowledge taxonomy (extract.ts / langextract.ts) is untouched —
 * the extractor service selects these variants only when `domain === "summit"`.
 */
import type { ExtractedEntity, ThoughtExtraction } from "./types";

/** Default note-entity taxonomy — admins can override per app (config.noteKinds). */
export const DEFAULT_NOTE_KINDS = [
  "need", "technology", "investor", "api", "mentor", "skill", "idea",
  "market", "startup", "country", "person", "organization", "concept",
] as const;

const kindsUnion = (kinds?: string[]): string =>
  (kinds?.length ? kinds : [...DEFAULT_NOTE_KINDS]).map((k) => `"${k}"`).join("|");

export const summitExtractionSystemPrompt = (kinds?: string[]): string => `You extract structured networking intelligence from a meeting note written at a startup event. The author may write in English or Persian/Farsi; preserve the original language of names.

Return ONLY a JSON object, no prose and no markdown fences, matching exactly:
{
  "title": string,                       // <= 8 words, the gist of the meeting
  "summary": string,                     // 1 sentence, what happened / matters
  "entities": [
    {
      "name": string,                    // the entity as a reader would name it
      "kind": ${kindsUnion(kinds)},
      "salience": number                 // 0..1, how central to the note
    }
  ],
  "relations": [
    { "source": string, "target": string, "label": string }   // label = short verb phrase
  ],
  "privacy": {
    "public_ok": boolean,                // safe to publish to ALL event attendees?
    "reasons": [string]                  // short phrases, only when public_ok is false
  }
}

Rules:
- 3 to 10 entities. Extract what matters for FOLLOW-UP: what they need, what they offer, what they build with, who was mentioned.
- "need" = something the person/startup is looking for ("React developer", "seed funding", "pilot customers").
- "api" = a concrete API/integration ("payments API", "recommendation API"). "technology" = tools/stacks ("React", "Neo4j").
- "market"/"country" = where they operate or target. "idea" = a product/collab idea raised in the meeting.
- relations connect entity names that appear in "entities" (e.g. "needs", "builds with", "targets", "introduced by"). 2 to 8 relations.
- Names must be reusable: normalize casing, drop articles, no trailing punctuation.
- "privacy": set public_ok=false when the note contains contact details (phone/email/address), confidential business info (round size, valuation, terms, anything said in confidence / "off the record" / under NDA), health or personal matters, or negative judgments about a named person. Each reason ≤ 8 words (e.g. "contains a phone number", "mentions confidential round size").`;

/** Back-compat: the default-taxonomy prompt. */
export const SUMMIT_EXTRACTION_SYSTEM_PROMPT = summitExtractionSystemPrompt();

/** Ollama/LangExtract flavour — same flat-extraction contract the parser expects. */
export function buildSummitLangExtractPrompt(text: string, kinds?: string[]): { system: string; user: string } {
  const system = `Extract networking intelligence from a startup-event meeting note as flat extractions, exactly like building a knowledge graph.

Rules:
1. Extract entities in the order they appear. Use the exact words from the text for "extraction_text" (preserve the original language; never translate names).
2. Each group of related entities shares the same "group" attribute value. Within every group exactly ONE entity is the anchor (usually the person or startup the note is about); the anchor's "relation" attribute is omitted, every other member's "relation" is a short verb phrase to the anchor ("needs", "builds with", "targets", "offers", "introduced by") — never just "related".
3. "extraction_class" must be one of: ${(kinds?.length ? kinds : [...DEFAULT_NOTE_KINDS]).join(", ")}.
   - need = something they are looking for · api = a concrete API/integration · technology = tools/stack · market/country = where they operate · idea = a product/collab idea.
4. Add a "salience" attribute (0..1). Aim for 3–10 entities in 1–2 groups. Normalize names: trim, drop articles, no trailing punctuation.
5. Also return a top-level "privacy" object: {"public_ok": boolean, "reasons": [string]} — public_ok=false when the note contains contact details (phone/email/address), confidential business info (round size, valuation, terms, "off the record", NDA), health/personal matters, or negative judgments about a named person. Reasons ≤ 8 words each.

Return ONLY JSON: {"title": string, "summary": string, "privacy": {"public_ok": boolean, "reasons": [string]}, "extractions": [{"extraction_class": string, "extraction_text": string, "attributes": {"group": string, "relation"?: string, "salience"?: number}}]}

Example — note: "Met Ana at the pitch tent. She's building FinCheck, a fintech for Armenia, needs a React dev and seed funding, could use our recommendation API."
{"title":"Met Ana of FinCheck","summary":"FinCheck (fintech, Armenia) needs a React dev + seed funding; possible recommendation-API integration.","extractions":[
 {"extraction_class":"person","extraction_text":"Ana","attributes":{"group":"ana","salience":1}},
 {"extraction_class":"startup","extraction_text":"FinCheck","attributes":{"group":"ana","relation":"is building","salience":0.9}},
 {"extraction_class":"market","extraction_text":"fintech","attributes":{"group":"ana","relation":"operates in","salience":0.7}},
 {"extraction_class":"country","extraction_text":"Armenia","attributes":{"group":"ana","relation":"targets","salience":0.6}},
 {"extraction_class":"need","extraction_text":"React dev","attributes":{"group":"ana","relation":"needs","salience":0.8}},
 {"extraction_class":"need","extraction_text":"seed funding","attributes":{"group":"ana","relation":"needs","salience":0.8}},
 {"extraction_class":"api","extraction_text":"recommendation API","attributes":{"group":"ana","relation":"could integrate","salience":0.7}}]}`;
  return { system, user: text };
}

/* --------------------------- privacy check --------------------------- */

/** Result of the "is this safe to post publicly?" assessment. */
export interface NotePrivacy {
  public_ok: boolean;
  reasons: string[];
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const PHONE_RE = /(?:\+|00)\d[\d\s().-]{7,}\d|\b\d{3}[-.\s]\d{3}[-.\s]\d{2,4}\b/;
const CONFIDENTIAL_RE = /\b(confidential|off the record|don'?t share|do not share|between us|nda|under nda)\b/i;
const MONEY_TERMS_RE = /\b(valuation|term sheet|cap table|burn rate|runway)\b/i;

/**
 * Deterministic privacy screen for meeting notes — used by the heuristic
 * extraction path and as a fallback when the model omits the "privacy" field.
 * Deliberately conservative: it flags, the USER decides (warn + confirm).
 */
export function summitPrivacyHeuristic(text: string): NotePrivacy {
  const reasons: string[] = [];
  if (EMAIL_RE.test(text)) reasons.push("contains an email address");
  if (PHONE_RE.test(text)) reasons.push("contains a phone number");
  if (CONFIDENTIAL_RE.test(text)) reasons.push("marked confidential / off the record");
  if (MONEY_TERMS_RE.test(text)) reasons.push("mentions sensitive deal terms");
  return { public_ok: reasons.length === 0, reasons };
}

/** Coerce a model-returned privacy blob; falls back to the heuristic. */
export function coerceNotePrivacy(raw: unknown, text: string): NotePrivacy {
  const o = raw as { public_ok?: unknown; reasons?: unknown } | null | undefined;
  if (o && typeof o.public_ok === "boolean") {
    const model: NotePrivacy = {
      public_ok: o.public_ok,
      reasons: Array.isArray(o.reasons) ? o.reasons.map(String).slice(0, 5) : [],
    };
    // Belt & braces: the regex screen can only ADD caution, never remove it.
    const heur = summitPrivacyHeuristic(text);
    if (!heur.public_ok) {
      return { public_ok: false, reasons: [...new Set([...model.reasons, ...heur.reasons])] };
    }
    return model;
  }
  return summitPrivacyHeuristic(text);
}

/* ------------------------- heuristic fallback ------------------------- */

/** Static snapshot of the curated event vocabularies (mirrors seed-summit.mjs)
 *  so the offline fallback still finds the entities that drive matching. */
const VOCAB: [ExtractedEntity["kind"], string[]][] = [
  ["technology", ["ai", "ml", "llm", "react", "next.js", "nextjs", "node", "python", "go", "graphql", "neo4j", "postgres", "kubernetes", "aws", "mobile", "flutter", "blockchain", "iot", "data engineering", "recommendation systems"]],
  ["api", ["recommendation api", "payments api", "maps api", "ai api", "data api", "auth api", "messaging api", "api integration", "api"]],
  ["need", ["funding", "co-founder", "cofounder", "engineers", "engineer", "designers", "designer", "marketing", "mentorship", "legal help", "pilot customers", "distribution", "cloud credits", "investor intros", "seed funding", "investment"]],
  ["skill", ["engineering", "design", "product", "growth", "sales", "data", "ops", "finance", "legal", "research", "community"]],
  ["market", ["fintech", "healthtech", "saas", "marketplace", "climate", "edtech", "ecommerce", "deeptech", "consumer", "gaming", "web3", "agritech", "traveltech", "europe", "mena", "global", "emerging markets"]],
  ["country", ["armenia", "georgia", "usa", "germany", "france", "uk", "netherlands", "estonia", "poland", "ukraine", "india", "uae"]],
  ["investor", ["investor", "angel", "vc", "venture capital", "syndicate"]],
  ["mentor", ["mentor", "advisor"]],
];

const cap = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

/** Deterministic, offline meeting-note extraction: vocabulary + proper-noun scan. */
export function summitHeuristicExtract(text: string): ThoughtExtraction {
  const lower = text.toLowerCase();
  const entities: ExtractedEntity[] = [];
  const seen = new Set<string>();
  const push = (name: string, kind: ExtractedEntity["kind"], salience: number) => {
    const key = name.toLowerCase();
    if (seen.has(key) || entities.length >= 10) return;
    seen.add(key);
    entities.push({ name, kind, salience });
  };

  // Vocabulary first — so "Armenia" reads as a country, not a person.
  for (const [kind, words] of VOCAB) {
    for (const w of words) {
      if (lower.includes(w)) push(cap(w), kind, 0.6);
    }
  }

  // Then proper nouns (skip sentence starts) read as people met.
  const names = text.match(/(?<=[a-z,;]\s)([A-Z][a-z]{2,})(?!\w)/g) ?? [];
  for (const n of names.slice(0, 3)) push(n, "person", 0.9);

  const first = entities[0];
  const relations = first
    ? entities.slice(1, 8).map((e) => ({
        source: first.name,
        target: e.name,
        label: e.kind === "need" ? "needs" : e.kind === "technology" || e.kind === "api" ? "uses" : "relates to",
      }))
    : [];

  return { title: text.split(/\s+/).slice(0, 6).join(" "), entities, relations };
}
