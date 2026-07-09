/**
 * Writings log — durable, per-user record of what people wrote, in Postgres.
 *
 * Neo4j stores the resulting graph nodes; Postgres is the source of truth for
 * the FULL writing (body + accepted extraction) plus an append-only event log
 * (what the AI extracted vs what the user accepted — i.e. their edits). The
 * `writing_events` table is intentionally generic (kind + JSON detail) so the
 * future assistant can append chat turns (kind: "message") to the same record.
 *
 * Degrades gracefully: if DATABASE_URL is unset, every call is a no-op.
 */
import pg from "pg";
import type { ThoughtExtraction } from "@constellation/graph-core";

const DATABASE_URL = process.env.DATABASE_URL?.trim();
let pool: pg.Pool | null = null;

export function writingsEnabled(): boolean {
  return !!pool;
}

export async function initWritings(): Promise<void> {
  if (!DATABASE_URL) {
    console.warn("graph-service: DATABASE_URL not set — writings log disabled");
    return;
  }
  const p = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
  await p.query(`
    CREATE TABLE IF NOT EXISTS writings (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      title       TEXT,
      body        TEXT NOT NULL,
      extraction  JSONB,
      status      TEXT NOT NULL DEFAULT 'woven',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  // The graph node id once woven (null while a draft). Added separately so
  // existing databases pick it up without a re-init.
  await p.query(`ALTER TABLE writings ADD COLUMN IF NOT EXISTS thought_id TEXT`);
  await p.query(`CREATE INDEX IF NOT EXISTS writings_user_idx ON writings(user_id, updated_at DESC)`);
  await p.query(`
    CREATE TABLE IF NOT EXISTS writing_events (
      id          BIGSERIAL PRIMARY KEY,
      writing_id  TEXT NOT NULL REFERENCES writings(id) ON DELETE CASCADE,
      user_id     TEXT NOT NULL,
      kind        TEXT NOT NULL,
      detail      JSONB,
      at          TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await p.query(`CREATE INDEX IF NOT EXISTS writing_events_idx ON writing_events(writing_id, at)`);
  pool = p;
  console.log("graph-service: writings log ready (postgres)");
}

/** Save (or update) a draft writing — no events, just keeps the row fresh. */
export async function saveDraft(i: {
  id: string;
  userId: string;
  title?: string;
  body: string;
  extraction: ThoughtExtraction;
}): Promise<void> {
  if (!pool) return;
  // Never demote an already-woven writing back to draft.
  await pool
    .query(
      `INSERT INTO writings (id, user_id, title, body, extraction, status, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'draft', now())
       ON CONFLICT (id) DO UPDATE
         SET title = EXCLUDED.title, body = EXCLUDED.body, extraction = EXCLUDED.extraction,
             status = CASE WHEN writings.status = 'woven' THEN 'woven' ELSE 'draft' END,
             updated_at = now()`,
      [i.id, i.userId, i.title ?? null, i.body, JSON.stringify(i.extraction)],
    )
    .catch((e) => console.error("graph-service: saveDraft failed:", e instanceof Error ? e.message : e));
}

export interface RecordWovenInput {
  /** The durable writing id (= draft id when resumed). */
  id: string;
  /** The graph node id created on weave. */
  thoughtId: string;
  userId: string;
  title?: string;
  body: string;
  extraction: ThoughtExtraction;
  /** The model's pre-edit extraction, when available — used to log the edit. */
  originalExtraction?: ThoughtExtraction;
}

/** Persist a woven writing + log the extraction/edit/weave events (one txn). */
export async function recordWoven(i: RecordWovenInput): Promise<void> {
  if (!pool) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO writings (id, user_id, title, body, extraction, status, thought_id, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'woven', $6, now())
       ON CONFLICT (id) DO UPDATE
         SET title = EXCLUDED.title, body = EXCLUDED.body,
             extraction = EXCLUDED.extraction, status = 'woven',
             thought_id = EXCLUDED.thought_id, updated_at = now()`,
      [i.id, i.userId, i.title ?? null, i.body, JSON.stringify(i.extraction), i.thoughtId],
    );
    const original = i.originalExtraction;
    if (original) {
      const edited = JSON.stringify(original) !== JSON.stringify(i.extraction);
      await client.query(
        `INSERT INTO writing_events (writing_id, user_id, kind, detail) VALUES ($1, $2, 'extracted', $3)`,
        [
          i.id,
          i.userId,
          JSON.stringify({ entities: original.entities?.length ?? 0, relations: original.relations?.length ?? 0 }),
        ],
      );
      if (edited) {
        await client.query(
          `INSERT INTO writing_events (writing_id, user_id, kind, detail) VALUES ($1, $2, 'edited', $3)`,
          [i.id, i.userId, JSON.stringify(diff(original, i.extraction))],
        );
      }
    }
    await client.query(
      `INSERT INTO writing_events (writing_id, user_id, kind, detail) VALUES ($1, $2, 'woven', $3)`,
      [
        i.id,
        i.userId,
        JSON.stringify({ entities: i.extraction.entities?.length ?? 0, relations: i.extraction.relations?.length ?? 0 }),
      ],
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("graph-service: recordWoven failed:", e instanceof Error ? e.message : e);
  } finally {
    client.release();
  }
}

/** A compact summary of what the user changed from the model's extraction. */
function diff(original: ThoughtExtraction, accepted: ThoughtExtraction) {
  const oNames = new Set((original.entities ?? []).map((e) => e.name.toLowerCase()));
  const aNames = new Set((accepted.entities ?? []).map((e) => e.name.toLowerCase()));
  const removed = [...oNames].filter((n) => !aNames.has(n));
  const added = [...aNames].filter((n) => !oNames.has(n));
  return {
    entitiesBefore: oNames.size,
    entitiesAfter: aNames.size,
    removed,
    added,
    relationsBefore: original.relations?.length ?? 0,
    relationsAfter: accepted.relations?.length ?? 0,
  };
}

export async function listWritings(userId: string) {
  if (!pool) return [];
  const r = await pool.query(
    `SELECT id, thought_id, title, status, extraction->>'summary' AS summary, created_at, updated_at
     FROM writings WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 100`,
    [userId],
  );
  return r.rows;
}

export async function getWriting(userId: string, id: string) {
  if (!pool) return null;
  const w = await pool.query(
    `SELECT id, thought_id, title, body, extraction, status, created_at, updated_at
     FROM writings WHERE user_id = $1 AND id = $2`,
    [userId, id],
  );
  if (!w.rows[0]) return null;
  const ev = await pool.query(
    `SELECT kind, detail, at FROM writing_events WHERE writing_id = $1 ORDER BY at ASC`,
    [id],
  );
  return { ...w.rows[0], events: ev.rows };
}
