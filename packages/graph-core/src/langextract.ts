/**
 * LangExtract-style extraction — the technique from the GraphRAG blog
 * (LangExtract + Neo4j + Qdrant + Ollama), adapted to Trusty.
 *
 *   https://medium.com/@manthapavankumar11/a-practical-graphrag-architecture-using-langextract-neo4j-qdrant-and-ollama-0e4c86908c41
 *
 * The blog's recipe:
 *   1. Give the model a `prompt_description` + a handful of grounded few-shot
 *      *examples* (lx.data.ExampleData / lx.data.Extraction).
 *   2. The model emits FLAT extractions, each carrying a grouping attribute so
 *      related facts can be re-assembled.
 *   3. `_convert_extractions_to_graph` groups those flat extractions, picks an
 *      anchor per group, and turns the rest into nodes + edges hanging off it.
 *
 * We keep that exact shape here (in TypeScript, so it lives in the same shared
 * package as the rest of the graph contract) and adapt it to Trusty's
 * taxonomy: anchors and members both become graph entities, and each member's
 * `relation` attribute becomes the edge label between them. The output is the
 * same {@link ThoughtExtraction} the rest of the pipeline already folds into the
 * graph via `ingestThought`, so nothing downstream has to change.
 */
import {
  ExtractedEntity,
  ExtractedRelation,
  TasteCluster,
  ThoughtExtraction,
} from "./types";

/* ------------------------------------------------------------------ */
/* The LangExtract data shapes (mirrors lx.data.*)                     */
/* ------------------------------------------------------------------ */

/** One flat extraction — the analogue of `lx.data.Extraction`. */
export interface LxExtraction {
  /** The kind of thing found — the analogue of `extraction_class`. */
  extraction_class: ExtractedEntity["kind"];
  /** The span of text, verbatim — the analogue of `extraction_text`. */
  extraction_text: string;
  /** Grouping + edge metadata — the analogue of `attributes`. */
  attributes?: {
    /** Ties related extractions together (the blog's `medication_group`). */
    group?: string;
    /** Verb phrase linking this extraction to its group's anchor. */
    relation?: string;
    /** Taste cluster, for cosmology colouring + recommendations. */
    cluster?: TasteCluster;
    /** 0..1, how central this is to the piece. */
    salience?: number;
  };
}

/** A worked example shown to the model — the analogue of `lx.data.ExampleData`. */
export interface LxExample {
  text: string;
  extractions: LxExtraction[];
}

/** The raw object we ask the (Ollama-hosted) model to return. */
export interface LxResult {
  title?: string;
  summary?: string;
  extractions: LxExtraction[];
}

/* ------------------------------------------------------------------ */
/* prompt_description + few-shot examples                              */
/* ------------------------------------------------------------------ */

/**
 * The extraction instructions (the blog's `prompt_description`). Tuned for
 * Trusty: we want the ideas a piece is *about* and how they connect,
 * in the author's original language (English or Persian/Farsi).
 */
export const LANGEXTRACT_PROMPT_DESCRIPTION = `Extract the entities a piece of writing is about and the relationships between them, using attributes to group related information — exactly like building a knowledge graph.

Rules:
1. Extract entities in the order they appear in the text. Use the exact words from the text for "extraction_text" (preserve the original language — English or Persian/Farsi; never translate names).
2. Each group of related entities shares the same "group" attribute value (this is what re-assembles them into a connected sub-graph).
3. Within every group, exactly ONE entity is the anchor — the central idea the others elaborate. The anchor's "relation" attribute is empty/omitted; every OTHER member's "relation" attribute is a short verb phrase saying how it connects to the anchor (e.g. "is evidence for", "contradicts", "is a prerequisite of", "enables") — never just "related".
4. Use "concept" for ideas/themes/arguments; use a concrete class (person, book, movie, music, location, organization, technology, event, work) only for named real things.
5. Add a "salience" attribute (0..1) for how central the entity is, and a "cluster" attribute when one of these fits: tech_ai, cinema, persian_culture, finance, indie_music, travel.
6. Aim for 4–12 entities across 1–3 groups. Normalize names: trim, drop leading articles, no trailing punctuation.`;

/**
 * Grounded few-shot examples (the blog's `examples=[lx.data.ExampleData(...)]`).
 * One English, one Persian — so the model anchors on Trusty's bilingual
 * world and on the grouping/anchor convention.
 */
export const LANGEXTRACT_EXAMPLES: LxExample[] = [
  {
    text:
      "Deep work is the ability to focus without distraction. Cal Newport argues it is a prerequisite for producing valuable output, and that social media erodes it by training the mind toward constant context-switching.",
    extractions: [
      {
        extraction_class: "concept",
        extraction_text: "deep work",
        attributes: { group: "deep work", salience: 1, cluster: "tech_ai" },
      },
      {
        extraction_class: "person",
        extraction_text: "Cal Newport",
        attributes: { group: "deep work", relation: "argues for", salience: 0.6 },
      },
      {
        extraction_class: "concept",
        extraction_text: "valuable output",
        attributes: {
          group: "deep work",
          relation: "is a prerequisite of",
          salience: 0.7,
        },
      },
      {
        extraction_class: "technology",
        extraction_text: "social media",
        attributes: { group: "deep work", relation: "erodes", salience: 0.8 },
      },
      {
        extraction_class: "concept",
        extraction_text: "context-switching",
        attributes: {
          group: "deep work",
          relation: "is caused by",
          salience: 0.5,
          cluster: "tech_ai",
        },
      },
    ],
  },
  {
    text:
      "فیلم جدایی نادر از سیمین ساختهٔ اصغر فرهادی، تنش میان وظیفهٔ اخلاقی و واقعیت طبقاتی را در تهران امروز روایت می‌کند.",
    extractions: [
      {
        extraction_class: "movie",
        extraction_text: "جدایی نادر از سیمین",
        attributes: { group: "جدایی نادر از سیمین", salience: 1, cluster: "cinema" },
      },
      {
        extraction_class: "person",
        extraction_text: "اصغر فرهادی",
        attributes: {
          group: "جدایی نادر از سیمین",
          relation: "کارگردانی کرده",
          salience: 0.7,
        },
      },
      {
        extraction_class: "concept",
        extraction_text: "وظیفهٔ اخلاقی",
        attributes: {
          group: "جدایی نادر از سیمین",
          relation: "درباره",
          salience: 0.8,
          cluster: "persian_culture",
        },
      },
      {
        extraction_class: "concept",
        extraction_text: "واقعیت طبقاتی",
        attributes: {
          group: "جدایی نادر از سیمین",
          relation: "در تضاد با",
          salience: 0.7,
          cluster: "persian_culture",
        },
      },
      {
        extraction_class: "location",
        extraction_text: "تهران",
        attributes: { group: "جدایی نادر از سیمین", relation: "رخ می‌دهد در", salience: 0.4 },
      },
    ],
  },
];

/* ------------------------------------------------------------------ */
/* Building the prompt sent to the local model                         */
/* ------------------------------------------------------------------ */

/** The JSON envelope we ask the model to fill — keeps Ollama's output parseable. */
const OUTPUT_CONTRACT = `Return ONLY a JSON object (no prose, no markdown fences) of exactly this shape:
{
  "title": string,                 // <= 8 words, the gist
  "summary": string,               // 1 sentence, the author's main point
  "extractions": [
    {
      "extraction_class": "concept"|"person"|"book"|"movie"|"music"|"location"|"organization"|"technology"|"event"|"work",
      "extraction_text": string,
      "attributes": { "group": string, "relation"?: string, "cluster"?: string, "salience"?: number }
    }
  ]
}`;

/**
 * Assemble the full LangExtract-style prompt: instructions, the grounded
 * few-shot examples, the output contract, then the text to process. Returned as
 * a system/user pair so callers can hand it straight to Ollama's chat endpoint.
 */
export function buildLangExtractPrompt(text: string): {
  system: string;
  user: string;
} {
  const examples = LANGEXTRACT_EXAMPLES.map(
    (ex, i) =>
      `Example ${i + 1}:\nText: ${JSON.stringify(ex.text)}\nExtractions: ${JSON.stringify(
        ex.extractions,
      )}`,
  ).join("\n\n");

  return {
    system: `${LANGEXTRACT_PROMPT_DESCRIPTION}\n\n${OUTPUT_CONTRACT}\n\n${examples}`,
    user: `Text:\n${text}`,
  };
}

/* ------------------------------------------------------------------ */
/* Flat extractions → graph (the blog's _convert_extractions_to_graph) */
/* ------------------------------------------------------------------ */

const CLUSTER_SET = new Set<TasteCluster>([
  "tech_ai",
  "cinema",
  "persian_culture",
  "finance",
  "indie_music",
  "travel",
]);

const VALID_KINDS = new Set<ExtractedEntity["kind"]>([
  "concept",
  "person",
  "book",
  "movie",
  "music",
  "location",
  "organization",
  "technology",
  "event",
  "work",
  // Trusty Sevan meeting-note kinds (emitted only by the summit prompts):
  "need",
  "api",
  "skill",
  "idea",
  "market",
  "startup",
  "investor",
  "mentor",
  "country",
]);

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * The TypeScript port of the blog's `_convert_extractions_to_graph`: take the
 * model's flat, grouped extractions and re-assemble them into the graph shape
 * the rest of Trusty speaks ({@link ThoughtExtraction}).
 *
 *   • group extractions by their `group` attribute
 *   • the anchor of each group is the member with no `relation` (else the most
 *     salient one) — the blog's "medication" anchor row
 *   • every extraction becomes an entity (de-duplicated by normalized name)
 *   • every non-anchor member becomes a `RELATES_TO`-style relation
 *     anchor → member, carrying its `relation` phrase as the label
 */
export function convertExtractionsToGraph(result: LxResult): ThoughtExtraction {
  const all = Array.isArray(result.extractions) ? result.extractions : [];

  // 1. group by the grouping attribute (fall back to the text itself).
  const groups = new Map<string, LxExtraction[]>();
  for (const ext of all) {
    if (!ext || typeof ext.extraction_text !== "string") continue;
    const name = ext.extraction_text.trim();
    if (!name) continue;
    const group = ext.attributes?.group?.trim() || name;
    const bucket = groups.get(group) ?? [];
    bucket.push(ext);
    groups.set(group, bucket);
  }

  // 2. walk each group, minting entities + anchor→member relations.
  const entities: ExtractedEntity[] = [];
  const relations: ExtractedRelation[] = [];
  const seen = new Map<string, ExtractedEntity>();

  const upsertEntity = (ext: LxExtraction): ExtractedEntity => {
    const name = ext.extraction_text.trim();
    const key = norm(name);
    const existing = seen.get(key);
    if (existing) {
      // keep the higher salience if we meet the same idea twice
      const sal = ext.attributes?.salience;
      if (typeof sal === "number" && sal > (existing.salience ?? 0)) {
        existing.salience = sal;
      }
      return existing;
    }
    const kind = VALID_KINDS.has(ext.extraction_class) ? ext.extraction_class : "concept";
    const cluster = ext.attributes?.cluster;
    const entity: ExtractedEntity = {
      name,
      mention: name,
      kind,
      cluster: cluster && CLUSTER_SET.has(cluster) ? cluster : undefined,
      salience:
        typeof ext.attributes?.salience === "number" ? ext.attributes.salience : 0.5,
    };
    seen.set(key, entity);
    entities.push(entity);
    return entity;
  };

  for (const members of groups.values()) {
    if (members.length === 0) continue;

    // anchor = the member with no explicit relation, else the most salient.
    const anchorExt =
      members.find((m) => !m.attributes?.relation?.trim()) ??
      [...members].sort(
        (a, b) => (b.attributes?.salience ?? 0) - (a.attributes?.salience ?? 0),
      )[0];

    const anchor = upsertEntity(anchorExt);

    for (const m of members) {
      const entity = upsertEntity(m);
      if (entity === anchor) continue;
      const label = m.attributes?.relation?.trim() || "relates to";
      relations.push({ source: anchor.name, target: entity.name, label });
    }
  }

  return {
    title: typeof result.title === "string" ? result.title : undefined,
    summary: typeof result.summary === "string" ? result.summary : undefined,
    entities,
    relations,
  };
}
