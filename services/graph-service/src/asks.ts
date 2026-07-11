/**
 * Ask-my-network — turning a cold-start dead end into edges (Feature 7).
 *
 * When trust-search finds nothing, the user broadcasts an ask to their sky
 * ("anyone trust a dentist in Yerevan?"). A friend answers by naming a provider,
 * and the ANSWER IS AN EDGE: the responder gains a real TRUSTS edge to that
 * provider (created by the caller), which — because asker↔responder are friends
 * — makes the asker's next search succeed. Search failures become content + the
 * graph's growth substrate.
 *
 * Mirrors invites.ts / outcomePrompts.ts; no-op without DATABASE_URL.
 */
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL?.trim();
let pool: pg.Pool | null = null;

export function asksEnabled(): boolean {
  return !!pool;
}

export async function initAsks(): Promise<void> {
  if (!DATABASE_URL) {
    console.warn("graph-service: DATABASE_URL not set — asks disabled");
    return;
  }
  const p = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
  await p.query(`
    CREATE TABLE IF NOT EXISTS asks (
      id          BIGSERIAL PRIMARY KEY,
      asker_id    TEXT NOT NULL,
      topic       TEXT NOT NULL,
      geo         TEXT,
      note        TEXT,
      status      TEXT NOT NULL DEFAULT 'open',   -- open | answered | closed
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  // App scope (App = Space = URL) — an ask stays in the app it was raised in.
  // Existing rows keep NULL and are treated as the "general" app via COALESCE.
  await p.query(`ALTER TABLE asks ADD COLUMN IF NOT EXISTS app TEXT`);
  await p.query(`CREATE INDEX IF NOT EXISTS asks_asker_idx ON asks(asker_id, created_at DESC)`);
  await p.query(`CREATE INDEX IF NOT EXISTS asks_open_idx ON asks(status, created_at DESC)`);
  await p.query(`
    CREATE TABLE IF NOT EXISTS ask_answers (
      id            BIGSERIAL PRIMARY KEY,
      ask_id        BIGINT NOT NULL REFERENCES asks(id) ON DELETE CASCADE,
      responder_id  TEXT NOT NULL,
      node_id       TEXT NOT NULL,
      edge_id       TEXT,
      note          TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  // One answer per (ask, responder, provider) — no accidental duplicates.
  await p.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS ask_answers_uniq ON ask_answers(ask_id, responder_id, node_id)`,
  );
  await p.query(`CREATE INDEX IF NOT EXISTS ask_answers_ask_idx ON ask_answers(ask_id, created_at)`);
  pool = p;
  console.log("graph-service: asks ready (postgres)");
}

export interface Ask {
  id: string;
  askerId: string;
  topic: string;
  geo?: string;
  note?: string;
  app: string;
  status: string;
  createdAt: string;
}

/** Rows created before app scoping have NULL app → treated as the general app. */
const GENERAL_APP = "general";

function rowToAsk(row: Record<string, unknown>): Ask {
  return {
    id: String(row.id),
    askerId: row.asker_id as string,
    topic: row.topic as string,
    geo: (row.geo as string) ?? undefined,
    note: (row.note as string) ?? undefined,
    app: (row.app as string) ?? GENERAL_APP,
    status: row.status as string,
    createdAt: String(row.created_at),
  };
}

export async function createAsk(
  askerId: string,
  input: { topic: string; geo?: string; note?: string; app?: string },
): Promise<Ask> {
  if (!pool) throw new Error("asks disabled");
  const r = await pool.query(
    `INSERT INTO asks (asker_id, topic, geo, note, app) VALUES ($1, $2, $3, $4, $5)
     RETURNING id, asker_id, topic, geo, note, app, status, created_at`,
    [askerId, input.topic, input.geo ?? null, input.note ?? null, input.app ?? GENERAL_APP],
  );
  return rowToAsk(r.rows[0]);
}

export async function getAsk(id: string): Promise<Ask | null> {
  if (!pool) return null;
  const r = await pool.query(`SELECT * FROM asks WHERE id = $1`, [id]);
  return r.rows[0] ? rowToAsk(r.rows[0]) : null;
}

export interface AskAnswer {
  id: string;
  askId: string;
  responderId: string;
  nodeId: string;
  edgeId?: string;
  note?: string;
  createdAt: string;
}

/**
 * Open asks broadcast into the viewer's sky: asks authored by one of their
 * friends that the viewer hasn't already answered. `friendIds` is computed by
 * the caller from the social graph.
 */
export async function asksInbox(
  responderId: string,
  friendIds: string[],
  app?: string,
): Promise<Ask[]> {
  if (!pool || friendIds.length === 0) return [];
  const r = await pool.query(
    `SELECT a.* FROM asks a
      WHERE a.status <> 'closed'
        AND a.asker_id = ANY($1)
        AND a.asker_id <> $2
        AND ($3::text IS NULL OR COALESCE(a.app, '${GENERAL_APP}') = $3)
        AND NOT EXISTS (
          SELECT 1 FROM ask_answers ans
           WHERE ans.ask_id = a.id AND ans.responder_id = $2
        )
      ORDER BY a.created_at DESC
      LIMIT 50`,
    [friendIds, responderId, app ?? null],
  );
  return r.rows.map(rowToAsk);
}

/** The viewer's own asks, newest first, each with its answers. */
export async function myAsks(
  askerId: string,
  app?: string,
): Promise<Array<Ask & { answers: AskAnswer[] }>> {
  if (!pool) return [];
  const a = await pool.query(
    `SELECT * FROM asks WHERE asker_id = $1
       AND ($2::text IS NULL OR COALESCE(app, '${GENERAL_APP}') = $2)
     ORDER BY created_at DESC LIMIT 50`,
    [askerId, app ?? null],
  );
  const asks = a.rows.map(rowToAsk);
  if (asks.length === 0) return [];
  const ans = await pool.query(
    `SELECT id, ask_id, responder_id, node_id, edge_id, note, created_at
       FROM ask_answers WHERE ask_id = ANY($1) ORDER BY created_at ASC`,
    [asks.map((x) => Number(x.id))],
  );
  const byAsk = new Map<string, AskAnswer[]>();
  for (const row of ans.rows) {
    const ansObj: AskAnswer = {
      id: String(row.id),
      askId: String(row.ask_id),
      responderId: row.responder_id,
      nodeId: row.node_id,
      edgeId: row.edge_id ?? undefined,
      note: row.note ?? undefined,
      createdAt: String(row.created_at),
    };
    const list = byAsk.get(ansObj.askId) ?? [];
    list.push(ansObj);
    byAsk.set(ansObj.askId, list);
  }
  return asks.map((x) => ({ ...x, answers: byAsk.get(x.id) ?? [] }));
}

/** Record an answer (the trust edge is created by the caller) + mark answered. */
export async function recordAnswer(input: {
  askId: string;
  responderId: string;
  nodeId: string;
  edgeId?: string;
  note?: string;
}): Promise<boolean> {
  if (!pool) return false;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query(
      `INSERT INTO ask_answers (ask_id, responder_id, node_id, edge_id, note)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING RETURNING id`,
      [input.askId, input.responderId, input.nodeId, input.edgeId ?? null, input.note ?? null],
    );
    await client.query(`UPDATE asks SET status = 'answered' WHERE id = $1 AND status = 'open'`, [
      input.askId,
    ]);
    await client.query("COMMIT");
    return (r.rowCount ?? 0) > 0;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("graph-service: recordAnswer failed:", e instanceof Error ? e.message : e);
    return false;
  } finally {
    client.release();
  }
}
