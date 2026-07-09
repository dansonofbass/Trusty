/**
 * Topic embeddings — semantic trust-search matching (Feature 9).
 *
 * Trust topics are embedded with BGE-M3 (via Ollama) and cached in pgvector, so
 * a "dentist" search can also surface an "orthodontist" someone trusts. Only the
 * neighbourhood expansion is done here (server-side I/O); the trust engine stays
 * pure — it just receives `expandedTopics`. Fails SAFE: any misconfiguration or
 * a model that isn't pulled disables semantic matching and trust-search falls
 * back to exact/parent equality, unchanged.
 *
 * Enable by pulling the model:  docker compose exec ollama ollama pull bge-m3
 */
import pg from "pg";
import { topicsWithinThreshold } from "@constellation/graph-core";

const DATABASE_URL = process.env.DATABASE_URL?.trim();
const EMBED_URL = (process.env.EMBEDDINGS_URL ?? "http://ollama:11434").replace(/\/+$/, "");
const EMBED_MODEL = process.env.EMBEDDINGS_MODEL ?? "bge-m3";
const DIM = Math.max(1, Number(process.env.EMBEDDINGS_DIM ?? 1024));
// Calibrated for BGE-M3 on short topic strings: genuine synonyms score ~0.74
// (dentist≈orthodontist), related pairs ~0.69, and the unrelated-profession
// noise floor is ≤0.65 — so 0.68 keeps real matches and drops noise.
export const TRUST_TOPIC_SIM_THRESHOLD = Number(process.env.TRUST_TOPIC_SIM_THRESHOLD ?? 0.68);

let pool: pg.Pool | null = null;
let disabled = process.env.EMBEDDINGS_DISABLED === "1";

export function embeddingsEnabled(): boolean {
  return !!pool && !disabled;
}

/** Create the pgvector cache. Non-fatal: on any failure, stays disabled. */
export async function initEmbeddings(): Promise<void> {
  if (!DATABASE_URL || disabled) {
    if (!DATABASE_URL) console.warn("graph-service: DATABASE_URL not set — semantic topics disabled");
    return;
  }
  try {
    const p = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
    await p.query(`CREATE EXTENSION IF NOT EXISTS vector`);
    await p.query(
      `CREATE TABLE IF NOT EXISTS topic_embeddings (
         topic       TEXT PRIMARY KEY,
         embedding   vector(${DIM}),
         created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
    );
    pool = p;
    console.log(`graph-service: topic embeddings ready (pgvector, ${EMBED_MODEL}/${DIM}d)`);
  } catch (e) {
    disabled = true;
    console.warn(
      "graph-service: pgvector unavailable — semantic topics disabled:",
      e instanceof Error ? e.message : e,
    );
  }
}

/** Embed strings via Ollama's /api/embed. Returns null on any failure. */
async function embed(inputs: string[]): Promise<number[][] | null> {
  try {
    const r = await fetch(`${EMBED_URL}/api/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL, input: inputs }),
      cache: "no-store",
    });
    if (!r.ok) throw new Error(`embed ${r.status}`);
    const data = (await r.json()) as { embeddings?: number[][] };
    const vecs = data.embeddings;
    if (!Array.isArray(vecs) || vecs.length !== inputs.length) throw new Error("bad embed shape");
    if (vecs[0]?.length !== DIM) throw new Error(`dim ${vecs[0]?.length} != ${DIM}`);
    return vecs;
  } catch (e) {
    // First failure (e.g. model not pulled) disables the feature for the session.
    disabled = true;
    console.warn("graph-service: embed failed — semantic topics off:", e instanceof Error ? e.message : e);
    return null;
  }
}

const toVectorLiteral = (v: number[]): string => `[${v.join(",")}]`;

/** Ensure the given topics are embedded + cached; returns those we have vectors for. */
async function ensureEmbeddings(topics: string[]): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  if (!pool || disabled || topics.length === 0) return out;

  const have = await pool.query(
    `SELECT topic, embedding::text AS embedding FROM topic_embeddings WHERE topic = ANY($1)`,
    [topics],
  );
  for (const row of have.rows) {
    out.set(row.topic, JSON.parse(row.embedding as string) as number[]);
  }
  const missing = topics.filter((t) => !out.has(t));
  if (missing.length === 0) return out;

  const vecs = await embed(missing);
  if (!vecs) return out; // disabled now — return what we had
  for (let i = 0; i < missing.length; i++) {
    const t = missing[i];
    const v = vecs[i];
    out.set(t, v);
    await pool
      .query(
        `INSERT INTO topic_embeddings (topic, embedding) VALUES ($1, $2::vector)
         ON CONFLICT (topic) DO NOTHING`,
        [t, toVectorLiteral(v)],
      )
      .catch(() => undefined);
  }
  return out;
}

/**
 * Topics from `candidates` semantically similar to `queryTopic` (≥ threshold),
 * excluding the query topic itself. [] when embeddings are unavailable — the
 * caller then relies on exact/parent matching only.
 */
export async function similarTopics(
  queryTopic: string,
  candidates: string[],
  threshold = TRUST_TOPIC_SIM_THRESHOLD,
): Promise<string[]> {
  if (!pool || disabled) return [];
  const distinct = [...new Set(candidates.filter((t) => t && t !== queryTopic))];
  if (distinct.length === 0) return [];

  const vecs = await ensureEmbeddings([queryTopic, ...distinct]);
  const qv = vecs.get(queryTopic);
  if (!qv) return [];
  const pairs = distinct
    .map((t) => ({ topic: t, vec: vecs.get(t) }))
    .filter((p): p is { topic: string; vec: number[] } => Array.isArray(p.vec));
  // Reuse graph-core's pure cosine expansion — same math the tests pin down.
  return topicsWithinThreshold(qv, pairs, threshold);
}
