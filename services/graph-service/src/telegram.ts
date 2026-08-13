/**
 * Telegram connector storage — sources, messages, runs, and the review queue.
 *
 * The queue is the whole point. This is knowledge about visas, fees and legal
 * deadlines, mined from a chat room by regular expressions and a language model;
 * publishing any of it automatically would be indefensible. Every candidate
 * waits for a human, and approval is the only path into the forum.
 *
 * Storage is Postgres when available (same pool as forum.ts); with no DB the
 * module degrades to no-ops so the rest of the service still boots.
 */
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
let pool: pg.Pool | null = null;

/** Same shape as initForum: owns its pool, degrades to no-ops without a DB. */
export async function initTelegram(): Promise<void> {
  if (!DATABASE_URL) {
    console.warn("graph-service: DATABASE_URL not set — telegram connector storage disabled");
    return;
  }
  const p = new pg.Pool({ connectionString: DATABASE_URL, max: 3 });
  await ensureTelegramSchema(p);
  pool = p;
}

export const telegramEnabled = (): boolean => pool !== null;

async function ensureTelegramSchema(p: pg.Pool) {
  await p.query(`
    CREATE TABLE IF NOT EXISTS tg_sources (
      id             TEXT PRIMARY KEY,
      title          TEXT NOT NULL,
      chat_id        TEXT,
      app            TEXT NOT NULL DEFAULT 'irham',
      default_circle TEXT NOT NULL,
      kind           TEXT NOT NULL DEFAULT 'export',
      lang           TEXT NOT NULL DEFAULT 'fa',
      enabled        BOOLEAN NOT NULL DEFAULT true,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);

  // Message text is kept so extraction can be re-run after tuning a lexicon —
  // rebuilding from the export every time would make threshold changes untestable.
  await p.query(`
    CREATE TABLE IF NOT EXISTS tg_messages (
      source_id   TEXT NOT NULL REFERENCES tg_sources(id) ON DELETE CASCADE,
      msg_id      BIGINT NOT NULL,
      sent_at     TIMESTAMPTZ NOT NULL,
      author_key  TEXT NOT NULL,
      author_name TEXT,
      body        TEXT NOT NULL,
      reply_to    BIGINT,
      cls         TEXT NOT NULL,
      confidence  REAL NOT NULL DEFAULT 0,
      topics      TEXT[] NOT NULL DEFAULT '{}',
      ent         JSONB NOT NULL DEFAULT '{}',
      has_media   BOOLEAN NOT NULL DEFAULT false,
      PRIMARY KEY (source_id, msg_id)
    )`);
  await p.query(`CREATE INDEX IF NOT EXISTS tg_messages_cls_idx ON tg_messages(source_id, cls)`);
  await p.query(`CREATE INDEX IF NOT EXISTS tg_messages_date_idx ON tg_messages(source_id, sent_at DESC)`);

  await p.query(`
    CREATE TABLE IF NOT EXISTS tg_candidates (
      key         TEXT PRIMARY KEY,
      source_id   TEXT NOT NULL REFERENCES tg_sources(id) ON DELETE CASCADE,
      kind        TEXT NOT NULL,
      payload     JSONB NOT NULL,
      confidence  REAL NOT NULL DEFAULT 0,
      stage       TEXT NOT NULL DEFAULT 'heuristic',
      status      TEXT NOT NULL DEFAULT 'pending',
      evidence    BIGINT[] NOT NULL DEFAULT '{}',
      published_post_id BIGINT,
      reviewed_by TEXT,
      reviewed_at TIMESTAMPTZ,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await p.query(
    `CREATE INDEX IF NOT EXISTS tg_candidates_queue_idx
       ON tg_candidates(status, kind, confidence DESC, created_at DESC)`,
  );

  await p.query(`
    CREATE TABLE IF NOT EXISTS tg_runs (
      id           BIGSERIAL PRIMARY KEY,
      source_id    TEXT NOT NULL REFERENCES tg_sources(id) ON DELETE CASCADE,
      started_at   TIMESTAMPTZ NOT NULL,
      finished_at  TIMESTAMPTZ NOT NULL,
      seen         INT NOT NULL DEFAULT 0,
      inserted     INT NOT NULL DEFAULT 0,
      by_class     JSONB NOT NULL DEFAULT '{}',
      candidates   JSONB NOT NULL DEFAULT '{}',
      warnings     TEXT[] NOT NULL DEFAULT '{}'
    )`);
  await p.query(`CREATE INDEX IF NOT EXISTS tg_runs_source_idx ON tg_runs(source_id, finished_at DESC)`);
}

/* -------------------------------- sources -------------------------------- */

export interface TgSourceRow {
  id: string; title: string; chatId: string | null; app: string;
  defaultCircle: string; kind: string; lang: string; enabled: boolean;
}

const sourceRow = (r: Record<string, unknown>): TgSourceRow => ({
  id: String(r.id), title: String(r.title),
  chatId: r.chat_id == null ? null : String(r.chat_id),
  app: String(r.app), defaultCircle: String(r.default_circle),
  kind: String(r.kind), lang: String(r.lang), enabled: Boolean(r.enabled),
});

export async function listSources(): Promise<TgSourceRow[]> {
  if (!pool) return [];
  const r = await pool.query(`SELECT * FROM tg_sources ORDER BY created_at`);
  return r.rows.map(sourceRow);
}

export async function upsertSource(s: {
  id: string; title: string; chatId?: string | null; app?: string;
  defaultCircle: string; kind?: string; lang?: string; enabled?: boolean;
}): Promise<TgSourceRow | null> {
  if (!pool) return null;
  const r = await pool.query(
    `INSERT INTO tg_sources (id,title,chat_id,app,default_circle,kind,lang,enabled)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (id) DO UPDATE SET
       title=EXCLUDED.title, chat_id=EXCLUDED.chat_id, app=EXCLUDED.app,
       default_circle=EXCLUDED.default_circle, kind=EXCLUDED.kind,
       lang=EXCLUDED.lang, enabled=EXCLUDED.enabled
     RETURNING *`,
    [s.id, s.title, s.chatId ?? null, s.app ?? "irham", s.defaultCircle,
     s.kind ?? "export", s.lang ?? "fa", s.enabled ?? true],
  );
  return sourceRow(r.rows[0]);
}

export async function deleteSource(id: string): Promise<void> {
  if (!pool) return;
  await pool.query(`DELETE FROM tg_sources WHERE id = $1`, [id]);
}

/* ------------------------------- messages -------------------------------- */

export interface IncomingMessage {
  id: number; date: string; from: string; authorKey: string; text: string;
  replyTo?: number; cls: string; confidence: number; topics: string[];
  ent: Record<string, number>; hasMedia: boolean;
}

/** Bulk insert, ignoring anything already stored. Returns how many were new. */
export async function saveMessages(sourceId: string, msgs: IncomingMessage[]): Promise<{ inserted: number; seen: number }> {
  if (!pool || msgs.length === 0) return { inserted: 0, seen: msgs.length };
  let inserted = 0;
  const CHUNK = 500;
  for (let i = 0; i < msgs.length; i += CHUNK) {
    const slice = msgs.slice(i, i + CHUNK);
    const values: unknown[] = [];
    const tuples = slice.map((m, j) => {
      const b = j * 12;
      values.push(sourceId, m.id, m.date, m.authorKey, m.from, m.text,
        m.replyTo ?? null, m.cls, m.confidence, m.topics ?? [], JSON.stringify(m.ent ?? {}),
        Boolean(m.hasMedia));
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10},$${b + 11}::jsonb,$${b + 12})`;
    });
    const r = await pool.query(
      `INSERT INTO tg_messages
         (source_id,msg_id,sent_at,author_key,author_name,body,reply_to,cls,confidence,topics,ent,has_media)
       VALUES ${tuples.join(",")}
       ON CONFLICT (source_id,msg_id) DO NOTHING`,
      values,
    );
    inserted += r.rowCount ?? 0;
  }
  return { inserted, seen: msgs.length };
}

export async function loadMessages(sourceId: string): Promise<unknown[]> {
  if (!pool) return [];
  const r = await pool.query(
    `SELECT msg_id, sent_at, author_key, author_name, body, reply_to, cls, confidence, topics, ent, has_media
       FROM tg_messages WHERE source_id = $1 ORDER BY msg_id`,
    [sourceId],
  );
  return r.rows.map((row) => ({
    sourceId,
    id: Number(row.msg_id),
    date: new Date(row.sent_at as string).toISOString(),
    authorKey: String(row.author_key),
    from: String(row.author_name ?? ""),
    text: String(row.body),
    replyTo: row.reply_to == null ? undefined : Number(row.reply_to),
    cls: String(row.cls),
    confidence: Number(row.confidence),
    topics: Array.isArray(row.topics) ? (row.topics as unknown[]).map(String) : [],
    ent: (row.ent ?? {}) as Record<string, number>,
    hasMedia: Boolean(row.has_media),
    why: [],
  }));
}

/* ------------------------------ candidates -------------------------------- */

export interface CandidateIn {
  key: string; kind: string; confidence: number; stage: string;
  evidence: number[]; [k: string]: unknown;
}

/**
 * Upsert candidates. A candidate a human already ruled on is never resurrected
 * by a re-run — re-extraction must not undo review.
 */
export async function saveCandidates(sourceId: string, list: CandidateIn[]): Promise<number> {
  if (!pool || list.length === 0) return 0;
  let n = 0;
  for (const c of list) {
    const r = await pool.query(
      `INSERT INTO tg_candidates (key,source_id,kind,payload,confidence,stage,evidence)
       VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7)
       ON CONFLICT (key) DO UPDATE SET
         payload=EXCLUDED.payload, confidence=EXCLUDED.confidence, stage=EXCLUDED.stage
       WHERE tg_candidates.status = 'pending'`,
      [c.key, sourceId, c.kind, JSON.stringify(c), c.confidence, c.stage, c.evidence ?? []],
    );
    n += r.rowCount ?? 0;
  }
  return n;
}

export interface QueueOpts { status?: string; kind?: string; sourceId?: string; limit?: number }

export async function listCandidates(o: QueueOpts = {}) {
  if (!pool) return [];
  const r = await pool.query(
    `SELECT key, source_id, kind, payload, confidence, stage, status, evidence,
            published_post_id, reviewed_by, reviewed_at, created_at
       FROM tg_candidates
      WHERE ($1::text IS NULL OR status = $1)
        AND ($2::text IS NULL OR kind = $2)
        AND ($3::text IS NULL OR source_id = $3)
      ORDER BY confidence DESC, created_at DESC
      LIMIT $4`,
    [o.status ?? "pending", o.kind ?? null, o.sourceId ?? null, Math.min(200, o.limit ?? 50)],
  );
  return r.rows.map((row) => ({
    key: String(row.key),
    sourceId: String(row.source_id),
    kind: String(row.kind),
    payload: row.payload as Record<string, unknown>,
    confidence: Number(row.confidence),
    stage: String(row.stage),
    status: String(row.status),
    evidence: Array.isArray(row.evidence) ? (row.evidence as unknown[]).map(Number) : [],
    publishedPostId: row.published_post_id == null ? null : String(row.published_post_id),
    reviewedBy: row.reviewed_by == null ? null : String(row.reviewed_by),
    createdAt: new Date(row.created_at as string).toISOString(),
  }));
}

export async function getCandidate(key: string) {
  if (!pool) return null;
  const r = await pool.query(`SELECT * FROM tg_candidates WHERE key = $1`, [key]);
  if (!r.rowCount) return null;
  const row = r.rows[0];
  return {
    key: String(row.key), sourceId: String(row.source_id), kind: String(row.kind),
    payload: row.payload as Record<string, unknown>, status: String(row.status),
    evidence: Array.isArray(row.evidence) ? (row.evidence as unknown[]).map(Number) : [],
  };
}

export async function markCandidate(
  key: string,
  status: "approved" | "rejected" | "pending",
  reviewer: string,
  postId?: string,
): Promise<void> {
  if (!pool) return;
  await pool.query(
    `UPDATE tg_candidates
        SET status=$2, reviewed_by=$3, reviewed_at=now(),
            published_post_id=COALESCE($4::bigint, published_post_id)
      WHERE key=$1`,
    [key, status, reviewer, postId ?? null],
  );
}

/** The evidence trail behind one candidate — what an admin reads before approving. */
export async function evidenceFor(sourceId: string, ids: number[]) {
  if (!pool || ids.length === 0) return [];
  const r = await pool.query(
    `SELECT msg_id, sent_at, author_name, body, cls FROM tg_messages
      WHERE source_id = $1 AND msg_id = ANY($2) ORDER BY msg_id`,
    [sourceId, ids],
  );
  return r.rows.map((row) => ({
    id: Number(row.msg_id),
    date: new Date(row.sent_at as string).toISOString(),
    from: String(row.author_name ?? ""),
    text: String(row.body),
    cls: String(row.cls),
  }));
}

/* --------------------------------- runs ---------------------------------- */

export async function saveRun(r: {
  sourceId: string; startedAt: string; finishedAt: string;
  messagesSeen: number; messagesNew: number;
  byClass: Record<string, number>; candidates: Record<string, number>; warnings: string[];
}): Promise<void> {
  if (!pool) return;
  await pool.query(
    `INSERT INTO tg_runs (source_id,started_at,finished_at,seen,inserted,by_class,candidates,warnings)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)`,
    [r.sourceId, r.startedAt, r.finishedAt, r.messagesSeen, r.messagesNew,
     JSON.stringify(r.byClass), JSON.stringify(r.candidates), r.warnings],
  );
}

export async function listRuns(sourceId?: string, limit = 20) {
  if (!pool) return [];
  const r = await pool.query(
    `SELECT * FROM tg_runs WHERE ($1::text IS NULL OR source_id=$1)
      ORDER BY finished_at DESC LIMIT $2`,
    [sourceId ?? null, limit],
  );
  return r.rows.map((row) => ({
    id: String(row.id), sourceId: String(row.source_id),
    startedAt: new Date(row.started_at as string).toISOString(),
    finishedAt: new Date(row.finished_at as string).toISOString(),
    seen: Number(row.seen), inserted: Number(row.inserted),
    byClass: row.by_class as Record<string, number>,
    candidates: row.candidates as Record<string, number>,
    warnings: Array.isArray(row.warnings) ? (row.warnings as unknown[]).map(String) : [],
  }));
}

/* -------------------------------- report --------------------------------- */

/**
 * The digest an admin can actually send to people: what changed in a group over
 * a window, in the terms members care about. Built from stored messages so it
 * works without re-ingesting.
 */
export async function digest(sourceId: string, sinceDays = 7) {
  if (!pool) return null;
  const since = `${sinceDays} days`;
  const [totals, topics, questions, providers] = await Promise.all([
    pool.query(
      `SELECT cls, count(*)::int AS n FROM tg_messages
        WHERE source_id=$1 AND sent_at > now() - $2::interval GROUP BY cls`,
      [sourceId, since],
    ),
    pool.query(
      `SELECT t AS topic, count(*)::int AS n FROM tg_messages, unnest(topics) AS t
        WHERE source_id=$1 AND sent_at > now() - $2::interval
        GROUP BY t ORDER BY n DESC LIMIT 8`,
      [sourceId, since],
    ),
    pool.query(
      `SELECT msg_id, body FROM tg_messages
        WHERE source_id=$1 AND cls='question' AND sent_at > now() - $2::interval
          AND NOT EXISTS (SELECT 1 FROM tg_messages r
                          WHERE r.source_id=tg_messages.source_id AND r.reply_to=tg_messages.msg_id)
        ORDER BY length(body) DESC LIMIT 10`,
      [sourceId, since],
    ),
    pool.query(
      `SELECT payload->>'provider' AS provider, payload->>'verdict' AS verdict,
              (payload->>'reporters')::int AS reporters
         FROM tg_candidates
        WHERE source_id=$1 AND kind='provider'
        ORDER BY reporters DESC NULLS LAST LIMIT 10`,
      [sourceId],
    ),
  ]);

  const byClass: Record<string, number> = {};
  for (const row of totals.rows) byClass[String(row.cls)] = Number(row.n);
  return {
    sourceId,
    windowDays: sinceDays,
    byClass,
    topTopics: topics.rows.map((r) => ({ topic: String(r.topic), n: Number(r.n) })),
    unansweredQuestions: questions.rows.map((r) => ({ id: Number(r.msg_id), text: String(r.body).slice(0, 400) })),
    providers: providers.rows.map((r) => ({
      provider: String(r.provider ?? ""), verdict: String(r.verdict ?? ""), reporters: Number(r.reporters ?? 0),
    })),
  };
}
