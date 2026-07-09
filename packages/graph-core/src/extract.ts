import {
  Dataset,
  ExtractedEntity,
  ExtractedRelation,
  EntitySource,
  GLink,
  GNode,
  NodeType,
  TasteCluster,
  ThoughtExtraction,
} from "./types";
import { refreshDerived } from "./recommend";
import { earnTokens, THOUGHT_REWARD } from "./economy";

const endId = (v: string | GNode): string => (typeof v === "string" ? v : v.id);

/* ------------------------------------------------------------------ */
/* The contract between the model and the graph                        */
/* ------------------------------------------------------------------ */

/**
 * The instruction we give Claude. Kept here so the service, tests, and docs
 * all reference one source of truth. The model must return ONLY JSON of shape
 * ThoughtExtraction — no prose, no markdown fences.
 */
export const EXTRACTION_SYSTEM_PROMPT = `You extract a knowledge graph from a piece of writing (an article, note, or stream of thought). The author may write in English or Persian/Farsi; preserve the original language of names and extract all things in same language.

Return ONLY a JSON object, no prose and no markdown fences, matching exactly:
{
  "title": string,                       // <= 8 words, the gist
  "summary": string,                      // 1 sentence, the author's main point
  "entities": [
    {
      "name": string,                     // the entity as a reader would name it
      "kind": "concept"|"person"|"book"|"movie"|"music"|"location"|"organization"|"technology"|"event"|"work",
      "cluster": "tech_ai"|"cinema"|"persian_culture"|"finance"|"indie_music"|"travel"|null,
      "salience": number                  // 0..1, how central to the piece
    }
  ],
  "relations": [
    { "source": string, "target": string, "label": string }   // label = short verb phrase
  ]
}

Rules:
- 4 to 12 entities. Prefer the ideas the author is actually reasoning about over incidental mentions.
- "concept" is for ideas/themes/arguments (e.g. "moral responsibility", "overfitting"). Use concrete kinds only for named real things.
- relations connect entity names that appear in "entities". 3 to 10 relations. Make the label meaningful ("contradicts", "is evidence for", "is a prerequisite of"), never just "related".
- Names must be reusable: normalize casing, drop articles, no trailing punctuation.`;

/* ------------------------------------------------------------------ */
/* Folding an extraction into the graph                                */
/* ------------------------------------------------------------------ */

const CLUSTER_SET = new Set<TasteCluster>([
  "tech_ai",
  "cinema",
  "persian_culture",
  "finance",
  "indie_music",
  "travel",
]);

const KIND_TO_NODE: Partial<Record<ExtractedEntity["kind"], NodeType>> = {
  person: "person",
  book: "book",
  movie: "movie",
  music: "music",
  location: "location",
  // organization/technology/event/work/concept all live as `concept` nodes —
  // the graph stays legible and these become first-class, recommendable ideas.
};

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

let thoughtSeq = 0;

/**
 * Ingest a model extraction as graph structure:
 *   • a `thought` node for the writing itself
 *   • `REFLECTS_ON`  me → thought
 *   • for each entity: reuse an existing node if the name matches, else mint a
 *     `concept` (or typed) node; link `MENTIONS` thought → entity
 *   • for each relation: `RELATES_TO` concept ↔ concept (carrying the label)
 *
 * Pure: returns a new Dataset with derived state refreshed, so the new
 * concepts immediately participate in recommendations.
 */
export function ingestThought(
  d: Dataset,
  authorId: string,
  rawText: string,
  extraction: ThoughtExtraction,
): { dataset: Dataset; thoughtId: string; conceptIds: string[] } {
  const author = d.nodes.find((n) => n.id === authorId);
  if (!author || author.type !== "person") throw new Error("author must be a person");

  const nodes: GNode[] = [...d.nodes];
  const links: GLink[] = [...d.links];
  const nowId = `th_${Date.now().toString(36)}${(thoughtSeq++ % 36).toString(36)}`;

  // index existing nodes by normalized label for entity reuse
  const byLabel = new Map<string, GNode>();
  for (const n of nodes) byLabel.set(norm(n.label), n);

  const title = (extraction.title ?? rawText.slice(0, 48)).trim();
  const clusters = pickThoughtClusters(extraction);

  const thought: GNode = {
    id: nowId,
    type: "thought",
    label: title.slice(0, 80),
    sub: extraction.summary?.slice(0, 160) ?? `${author.isMe ? "You" : author.label} · note`,
    clusters,
    // original prose + structure, for the inspector and future re-extraction
    body: rawText,
    extraction,
  };
  nodes.push(thought);
  links.push({
    id: `re_${nowId}`,
    source: authorId,
    target: nowId,
    type: "REFLECTS_ON",
    weight: 1,
  });

  const conceptIds: string[] = [];
  const nameToId = new Map<string, string>();

  for (const e of extraction.entities) {
    const key = norm(e.name);
    if (!key) continue;
    let node = byLabel.get(key);
    if (!node) {
      const nodeType = KIND_TO_NODE[e.kind] ?? "concept";
      const cluster = e.cluster && CLUSTER_SET.has(e.cluster) ? e.cluster : clusters[0];
      node = {
        id: `cn_${nowId}_${conceptIds.length}`,
        type: nodeType,
        label: e.name.trim().slice(0, 64),
        sub: nodeType === "concept" ? labelForKind(e.kind) : undefined,
        clusters: cluster ? [cluster] : [],
        sources: e.sources?.length ? [...e.sources] : undefined,
        // An extracted person is a public figure (linkable like an entity),
        // not a social account.
        figure: nodeType === "person" ? true : undefined,
      };
      nodes.push(node);
      byLabel.set(key, node);
    } else if (e.sources?.length) {
      node = {
        ...node,
        sources: mergeSources(node.sources, e.sources),
      };
      const idx = nodes.findIndex((n) => n.id === node!.id);
      if (idx >= 0) nodes[idx] = node;
      byLabel.set(key, node);
    }
    nameToId.set(key, node.id);
    if (node.type === "concept" || node.id.startsWith("cn_")) conceptIds.push(node.id);
    links.push({
      id: `mn_${nowId}_${node.id}`,
      source: nowId,
      target: node.id,
      type: "MENTIONS",
      weight: e.salience ?? 0.5,
    });
  }

  // concept ↔ concept relations
  let rseq = 0;
  for (const r of extraction.relations) {
    const a = nameToId.get(norm(r.source));
    const b = nameToId.get(norm(r.target));
    if (!a || !b || a === b) continue;
    links.push({
      id: `rl_${nowId}_${rseq++}`,
      source: a,
      target: b,
      type: "RELATES_TO",
      weight: 1,
      label: r.label,
    });
  }

  // Writing is a contribution to the shared graph — reward the author.
  let dataset = refreshDerived({ ...d, nodes, links });
  if (author.isMe) dataset = earnTokens(dataset, THOUGHT_REWARD, "thought", nowId);

  return { dataset, thoughtId: nowId, conceptIds };
}

function pickThoughtClusters(ex: ThoughtExtraction): TasteCluster[] {
  const tally = new Map<TasteCluster, number>();
  for (const e of ex.entities) {
    if (e.cluster && CLUSTER_SET.has(e.cluster))
      tally.set(e.cluster, (tally.get(e.cluster) ?? 0) + (e.salience ?? 0.5));
  }
  return [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([c]) => c);
}

function mergeSources(existing: EntitySource[] | undefined, next: EntitySource[]): EntitySource[] {
  const out = [...(existing ?? [])];
  for (const s of next) {
    if (!out.some((x) => x.provider === s.provider && x.url === s.url)) out.push(s);
  }
  return out;
}

function labelForKind(kind: ExtractedEntity["kind"]): string {
  switch (kind) {
    case "technology":
      return "Technology";
    case "organization":
      return "Organization";
    case "event":
      return "Event";
    case "work":
      return "Work";
    default:
      return "Concept";
  }
}

/**
 * A deterministic, offline fallback "extraction" used when no ANTHROPIC_API_KEY
 * is set (mock mode, demos, tests). Crude noun-phrase-ish heuristic — good
 * enough to show the pipeline shape; the real model output is far richer.
 */
export function heuristicExtract(text: string): ThoughtExtraction {
  const clean = text.replace(/\s+/g, " ").trim();
  const sentences = clean.split(/(?<=[.!?؟])\s+/).filter(Boolean);
  const stop = new Set(
    "the a an and or but of to in on for with is are was were be been being this that these those it its as at by from we i you they he she them our your their about into over under than then so if not no yes can will would could should may might must do does did has have had".split(
      " ",
    ),
  );
  // Capitalized runs + frequent salient words become entities.
  const phrases = new Map<string, number>();
  const capRun = /([A-Z\u0600-\u06FF][\w\u0600-\u06FF'-]*(?:\s+[A-Z\u0600-\u06FF][\w\u0600-\u06FF'-]*){0,3})/g;
  let m: RegExpExecArray | null;
  while ((m = capRun.exec(clean))) {
    const p = m[1].trim();
    if (p.length > 2) phrases.set(p, (phrases.get(p) ?? 0) + 2);
  }
  for (const w of clean.toLowerCase().split(/[^a-z\u0600-\u06FF'-]+/)) {
    if (w.length > 5 && !stop.has(w)) phrases.set(w, (phrases.get(w) ?? 0) + 1);
  }
  const entities: ExtractedEntity[] = [...phrases.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name], i, arr) => ({
      name,
      mention: name,
      kind: /^[A-Z\u0600-\u06FF]/.test(name) ? "concept" : "concept",
      salience: 1 - i / (arr.length + 1),
    }));
  // chain the top entities so there's a visible web
  const relations: ExtractedRelation[] = [];
  for (let i = 0; i < entities.length - 1 && i < 6; i++) {
    relations.push({
      source: entities[i].name,
      target: entities[i + 1].name,
      label: "relates to",
    });
  }
  return {
    title: sentences[0]?.split(" ").slice(0, 8).join(" ") ?? "Untitled thought",
    summary: sentences[0]?.slice(0, 160) ?? clean.slice(0, 160),
    entities,
    relations,
  };
}
