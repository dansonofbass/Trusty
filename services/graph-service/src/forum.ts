/**
 * Circle forum — the structured replacement for circle group chat.
 *
 * Telegram's failure mode is that the knowledge exists but isn't retrievable:
 * the same residency question is re-asked monthly and the best answer is
 * buried mid-thread. So a circle is a forum, not a chat: a curated skeleton of
 * TOPICS (admin/mod-created), QUESTIONS inside them, and voted ANSWERS.
 *
 * Naming: `circle_topics` here are forum sections. They are NOT the
 * `topicTags` taxonomy on circles/specialists (immigration, accountant, …)
 * which drives specialist matching — different axis, deliberately kept apart.
 *
 * Authority mirrors specialists.ts: a role table + a permission matrix, so the
 * platform has one authority pattern rather than two. No-op without
 * DATABASE_URL, like every other module here.
 */
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL?.trim();
let pool: pg.Pool | null = null;

export function forumEnabled(): boolean {
  return !!pool;
}

/* ------------------------------- types ------------------------------- */

export type CircleRole = "owner" | "moderator";

export interface CirclePermissions {
  manageTopics: boolean;
  moderatePosts: boolean;
  manageRoles: boolean;
}

/** Least-privilege matrix — an owner may delegate, a moderator may not. */
export const CIRCLE_ROLE_PERMISSIONS: Record<CircleRole, CirclePermissions> = {
  owner: { manageTopics: true, moderatePosts: true, manageRoles: true },
  moderator: { manageTopics: true, moderatePosts: true, manageRoles: false },
};

export const CIRCLE_ROLES = Object.keys(CIRCLE_ROLE_PERMISSIONS) as CircleRole[];

export type VoteSubject = "post" | "answer";

export interface TopicRow {
  id: string;
  circleId: string;
  label: string;
  description: string;
  position: number;
  postCount: number;
  createdAt: string;
}

export interface PostRow {
  id: string;
  circleId: string;
  topicId: string | null;
  authorId: string;
  title: string;
  body: string;
  pinned: boolean;
  locked: boolean;
  answerCount: number;
  score: number;
  /** The viewer's own vote (-1 | 0 | 1) — set by callers that pass a viewer. */
  myVote: number;
  createdAt: string;
}

export interface AnswerRow {
  id: string;
  postId: string;
  parentId: string | null;
  authorId: string;
  body: string;
  accepted: boolean;
  deleted: boolean;
  score: number;
  myVote: number;
  createdAt: string;
}

export interface CircleRoleRow {
  userId: string;
  role: CircleRole;
  addedBy: string;
  createdAt: string;
}

/* -------------------------------- init ------------------------------- */

export async function initForum(): Promise<void> {
  if (!DATABASE_URL) {
    console.warn("graph-service: DATABASE_URL not set — circle forum disabled");
    return;
  }
  const p = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });

  await p.query(`
    CREATE TABLE IF NOT EXISTS circle_topics (
      id          BIGSERIAL PRIMARY KEY,
      circle_id   TEXT NOT NULL,
      label       TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      position    INT  NOT NULL DEFAULT 0,
      created_by  TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await p.query(`CREATE INDEX IF NOT EXISTS circle_topics_circle_idx ON circle_topics(circle_id, position, id)`);

  await p.query(`
    CREATE TABLE IF NOT EXISTS posts (
      id            BIGSERIAL PRIMARY KEY,
      circle_id     TEXT NOT NULL,
      topic_id      BIGINT REFERENCES circle_topics(id) ON DELETE SET NULL,
      author_id     TEXT NOT NULL,
      title         TEXT NOT NULL,
      body          TEXT NOT NULL DEFAULT '',
      pinned        BOOLEAN NOT NULL DEFAULT false,
      locked        BOOLEAN NOT NULL DEFAULT false,
      deleted       BOOLEAN NOT NULL DEFAULT false,
      answer_count  INT NOT NULL DEFAULT 0,
      score         INT NOT NULL DEFAULT 0,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await p.query(`CREATE INDEX IF NOT EXISTS posts_circle_idx ON posts(circle_id, pinned DESC, created_at DESC)`);
  await p.query(`CREATE INDEX IF NOT EXISTS posts_topic_idx ON posts(topic_id, pinned DESC, created_at DESC)`);
  await p.query(`CREATE INDEX IF NOT EXISTS posts_author_idx ON posts(author_id)`);
  // Migrated saved answers carry their origin so the one-off migration is idempotent.
  await p.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS migrated_from_answer BIGINT`);
  await p.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS posts_migrated_uniq ON posts(migrated_from_answer) WHERE migrated_from_answer IS NOT NULL`,
  );

  await p.query(`
    CREATE TABLE IF NOT EXISTS post_answers (
      id          BIGSERIAL PRIMARY KEY,
      post_id     BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      parent_id   BIGINT REFERENCES post_answers(id) ON DELETE CASCADE,
      author_id   TEXT NOT NULL,
      body        TEXT NOT NULL,
      accepted    BOOLEAN NOT NULL DEFAULT false,
      deleted     BOOLEAN NOT NULL DEFAULT false,
      score       INT NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await p.query(`CREATE INDEX IF NOT EXISTS post_answers_post_idx ON post_answers(post_id, score DESC, created_at)`);
  await p.query(`CREATE INDEX IF NOT EXISTS post_answers_author_idx ON post_answers(author_id)`);

  // Keyed on (subject, user): re-voting is an upsert, un-voting is a delete.
  // Double counting is impossible by construction rather than by care.
  await p.query(`
    CREATE TABLE IF NOT EXISTS votes (
      subject_type TEXT NOT NULL,
      subject_id   BIGINT NOT NULL,
      user_id      TEXT NOT NULL,
      value        SMALLINT NOT NULL,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (subject_type, subject_id, user_id)
    )`);

  await p.query(`
    CREATE TABLE IF NOT EXISTS circle_roles (
      circle_id   TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      role        TEXT NOT NULL,
      added_by    TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (circle_id, user_id)
    )`);
  await p.query(`CREATE INDEX IF NOT EXISTS circle_roles_circle_idx ON circle_roles(circle_id)`);

  pool = p;
  console.log("graph-service: circle forum ready (postgres)");
}

/* ------------------------------- roles ------------------------------- */

export async function rolesFor(circleId: string): Promise<CircleRoleRow[]> {
  if (!pool) return [];
  const r = await pool.query(
    `SELECT user_id, role, added_by, created_at FROM circle_roles WHERE circle_id = $1 ORDER BY role, created_at`,
    [circleId],
  );
  return r.rows.map((row) => ({
    userId: String(row.user_id),
    role: row.role as CircleRole,
    addedBy: String(row.added_by),
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

/** Circle-scoped permissions. Platform admins are handled by the ROUTE, which
 *  passes `actorIsAdmin` — this stays purely about circle authority. */
export async function permissionsIn(circleId: string, userId: string): Promise<CirclePermissions | null> {
  if (!pool) return null;
  const r = await pool.query(`SELECT role FROM circle_roles WHERE circle_id = $1 AND user_id = $2`, [circleId, userId]);
  if (!r.rowCount) return null;
  return CIRCLE_ROLE_PERMISSIONS[r.rows[0].role as CircleRole] ?? null;
}

export async function setRole(
  circleId: string,
  userId: string,
  role: CircleRole,
  addedBy: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!pool) return { ok: false, error: "forum disabled" };
  if (!CIRCLE_ROLES.includes(role)) return { ok: false, error: "unknown role" };
  await pool.query(
    `INSERT INTO circle_roles (circle_id, user_id, role, added_by) VALUES ($1, $2, $3, $4)
     ON CONFLICT (circle_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
    [circleId, userId, role, addedBy],
  );
  return { ok: true };
}

export async function removeRole(circleId: string, userId: string): Promise<void> {
  if (!pool) return;
  await pool.query(`DELETE FROM circle_roles WHERE circle_id = $1 AND user_id = $2`, [circleId, userId]);
}

/** Moderator/owner ids across many circles at once — for badge resolution. */
export async function rolesForUsers(userIds: string[]): Promise<Record<string, { circleId: string; role: CircleRole }[]>> {
  if (!pool || userIds.length === 0) return {};
  const r = await pool.query(`SELECT circle_id, user_id, role FROM circle_roles WHERE user_id = ANY($1)`, [userIds]);
  const out: Record<string, { circleId: string; role: CircleRole }[]> = {};
  for (const row of r.rows) {
    const uid = String(row.user_id);
    (out[uid] ??= []).push({ circleId: String(row.circle_id), role: row.role as CircleRole });
  }
  return out;
}

/* ------------------------------- topics ------------------------------ */

export async function listTopics(circleId: string): Promise<TopicRow[]> {
  if (!pool) return [];
  const r = await pool.query(
    `SELECT t.*, (SELECT count(*) FROM posts p WHERE p.topic_id = t.id AND NOT p.deleted) AS post_count
       FROM circle_topics t WHERE t.circle_id = $1 ORDER BY t.position, t.id`,
    [circleId],
  );
  return r.rows.map((row) => ({
    id: String(row.id),
    circleId: String(row.circle_id),
    label: String(row.label),
    description: String(row.description ?? ""),
    position: Number(row.position ?? 0),
    postCount: Number(row.post_count ?? 0),
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

export async function createTopic(input: {
  circleId: string;
  label: string;
  description?: string;
  position?: number;
  createdBy: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!pool) return { ok: false, error: "forum disabled" };
  const label = input.label.trim();
  if (!label) return { ok: false, error: "label required" };
  const r = await pool.query(
    `INSERT INTO circle_topics (circle_id, label, description, position, created_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [input.circleId, label.slice(0, 80), (input.description ?? "").trim().slice(0, 300), input.position ?? 0, input.createdBy],
  );
  return { ok: true, id: String(r.rows[0].id) };
}

export async function updateTopic(
  id: string,
  patch: { label?: string; description?: string; position?: number },
): Promise<void> {
  if (!pool) return;
  await pool.query(
    `UPDATE circle_topics SET
       label       = COALESCE($2, label),
       description = COALESCE($3, description),
       position    = COALESCE($4, position)
     WHERE id = $1`,
    [id, patch.label?.trim().slice(0, 80) ?? null, patch.description?.trim().slice(0, 300) ?? null, patch.position ?? null],
  );
}

/** Posts survive (topic_id → NULL via FK) so deleting a section never eats knowledge. */
export async function deleteTopic(id: string): Promise<void> {
  if (!pool) return;
  await pool.query(`DELETE FROM circle_topics WHERE id = $1`, [id]);
}

export async function topicCircle(topicId: string): Promise<string | null> {
  if (!pool) return null;
  const r = await pool.query(`SELECT circle_id FROM circle_topics WHERE id = $1`, [topicId]);
  return r.rowCount ? String(r.rows[0].circle_id) : null;
}

/* -------------------------------- posts ------------------------------ */

const postRow = (row: Record<string, unknown>): PostRow => ({
  id: String(row.id),
  circleId: String(row.circle_id),
  topicId: row.topic_id == null ? null : String(row.topic_id),
  authorId: String(row.author_id),
  title: String(row.title),
  body: String(row.body ?? ""),
  pinned: !!row.pinned,
  locked: !!row.locked,
  answerCount: Number(row.answer_count ?? 0),
  score: Number(row.score ?? 0),
  myVote: Number(row.my_vote ?? 0),
  createdAt: new Date(row.created_at as string).toISOString(),
});

export type PostSort = "hot" | "new" | "top";

/** Pinned always first; then the chosen sort. "hot" = score, freshest first
 *  on ties — enough ordering for a young community without a decay formula. */
const ORDER_BY: Record<PostSort, string> = {
  hot: "p.pinned DESC, p.score DESC, p.created_at DESC",
  new: "p.pinned DESC, p.created_at DESC",
  top: "p.pinned DESC, p.score DESC, p.answer_count DESC",
};

export async function listPosts(opts: {
  circleId?: string;
  topicId?: string;
  viewerId?: string;
  sort?: PostSort;
  limit?: number;
}): Promise<PostRow[]> {
  if (!pool) return [];
  const order = ORDER_BY[opts.sort ?? "hot"];
  const r = await pool.query(
    `SELECT p.*, COALESCE(v.value, 0) AS my_vote
       FROM posts p
       LEFT JOIN votes v ON v.subject_type = 'post' AND v.subject_id = p.id AND v.user_id = $3
      WHERE NOT p.deleted
        AND ($1::text IS NULL OR p.circle_id = $1)
        AND ($2::bigint IS NULL OR p.topic_id = $2)
      ORDER BY ${order}
      LIMIT $4`,
    [opts.circleId ?? null, opts.topicId ?? null, opts.viewerId ?? "", opts.limit ?? 50],
  );
  return r.rows.map(postRow);
}

export async function getPost(id: string, viewerId?: string): Promise<PostRow | null> {
  if (!pool) return null;
  const r = await pool.query(
    `SELECT p.*, COALESCE(v.value, 0) AS my_vote
       FROM posts p
       LEFT JOIN votes v ON v.subject_type = 'post' AND v.subject_id = p.id AND v.user_id = $2
      WHERE p.id = $1 AND NOT p.deleted`,
    [id, viewerId ?? ""],
  );
  return r.rowCount ? postRow(r.rows[0]) : null;
}

export async function createPost(input: {
  circleId: string;
  topicId?: string | null;
  authorId: string;
  title: string;
  body?: string;
  createdAt?: string;
  migratedFromAnswer?: number;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!pool) return { ok: false, error: "forum disabled" };
  const title = input.title.trim();
  if (!title) return { ok: false, error: "title required" };
  const r = await pool.query(
    `INSERT INTO posts (circle_id, topic_id, author_id, title, body, created_at, updated_at, migrated_from_answer)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, now()), now(), $7)
     ON CONFLICT (migrated_from_answer) WHERE migrated_from_answer IS NOT NULL DO NOTHING
     RETURNING id`,
    [
      input.circleId,
      input.topicId ?? null,
      input.authorId,
      title.slice(0, 200),
      (input.body ?? "").slice(0, 20000),
      input.createdAt ?? null,
      input.migratedFromAnswer ?? null,
    ],
  );
  if (!r.rowCount) return { ok: false, error: "already migrated" };
  return { ok: true, id: String(r.rows[0].id) };
}

export async function setPostFlags(
  id: string,
  patch: { pinned?: boolean; locked?: boolean; deleted?: boolean },
): Promise<void> {
  if (!pool) return;
  await pool.query(
    `UPDATE posts SET pinned = COALESCE($2, pinned), locked = COALESCE($3, locked),
                      deleted = COALESCE($4, deleted), updated_at = now()
      WHERE id = $1`,
    [id, patch.pinned ?? null, patch.locked ?? null, patch.deleted ?? null],
  );
}

/* ------------------------------- answers ----------------------------- */

const answerRow = (row: Record<string, unknown>): AnswerRow => ({
  id: String(row.id),
  postId: String(row.post_id),
  parentId: row.parent_id == null ? null : String(row.parent_id),
  authorId: String(row.author_id),
  body: row.deleted ? "" : String(row.body),
  accepted: !!row.accepted,
  deleted: !!row.deleted,
  score: Number(row.score ?? 0),
  myVote: Number(row.my_vote ?? 0),
  createdAt: new Date(row.created_at as string).toISOString(),
});

/** Accepted first, then score — the whole point is that the best answer is
 *  never buried, which is the Telegram failure this replaces. */
export async function listAnswers(postId: string, viewerId?: string): Promise<AnswerRow[]> {
  if (!pool) return [];
  const r = await pool.query(
    `SELECT a.*, COALESCE(v.value, 0) AS my_vote
       FROM post_answers a
       LEFT JOIN votes v ON v.subject_type = 'answer' AND v.subject_id = a.id AND v.user_id = $2
      WHERE a.post_id = $1
      ORDER BY a.accepted DESC, a.score DESC, a.created_at`,
    [postId, viewerId ?? ""],
  );
  return r.rows.map(answerRow);
}

export async function createAnswer(input: {
  postId: string;
  parentId?: string | null;
  authorId: string;
  body: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!pool) return { ok: false, error: "forum disabled" };
  const body = input.body.trim();
  if (!body) return { ok: false, error: "body required" };

  const locked = await pool.query(`SELECT locked FROM posts WHERE id = $1 AND NOT deleted`, [input.postId]);
  if (!locked.rowCount) return { ok: false, error: "post not found" };
  if (locked.rows[0].locked) return { ok: false, error: "this thread is locked" };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query(
      `INSERT INTO post_answers (post_id, parent_id, author_id, body) VALUES ($1, $2, $3, $4) RETURNING id`,
      [input.postId, input.parentId ?? null, input.authorId, body.slice(0, 20000)],
    );
    await client.query(`UPDATE posts SET answer_count = answer_count + 1, updated_at = now() WHERE id = $1`, [
      input.postId,
    ]);
    await client.query("COMMIT");
    return { ok: true, id: String(r.rows[0].id) };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/** One accepted answer per post — accepting a second un-accepts the first. */
export async function acceptAnswer(answerId: string): Promise<{ ok: true; postId: string } | { ok: false; error: string }> {
  if (!pool) return { ok: false, error: "forum disabled" };
  const found = await pool.query(`SELECT post_id FROM post_answers WHERE id = $1`, [answerId]);
  if (!found.rowCount) return { ok: false, error: "answer not found" };
  const postId = String(found.rows[0].post_id);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`UPDATE post_answers SET accepted = false WHERE post_id = $1`, [postId]);
    await client.query(`UPDATE post_answers SET accepted = true WHERE id = $1`, [answerId]);
    await client.query("COMMIT");
    return { ok: true, postId };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function deleteAnswer(answerId: string): Promise<void> {
  if (!pool) return;
  await pool.query(`UPDATE post_answers SET deleted = true, body = '' WHERE id = $1`, [answerId]);
}

export async function answerAuthor(answerId: string): Promise<string | null> {
  if (!pool) return null;
  const r = await pool.query(`SELECT author_id FROM post_answers WHERE id = $1`, [answerId]);
  return r.rowCount ? String(r.rows[0].author_id) : null;
}

/** The post an answer belongs to — lets a route authorise against the thread
 *  before mutating the answer. */
export async function answerPost(answerId: string): Promise<string | null> {
  if (!pool) return null;
  const r = await pool.query(`SELECT post_id FROM post_answers WHERE id = $1`, [answerId]);
  return r.rowCount ? String(r.rows[0].post_id) : null;
}

export async function postAuthor(postId: string): Promise<string | null> {
  if (!pool) return null;
  const r = await pool.query(`SELECT author_id FROM posts WHERE id = $1`, [postId]);
  return r.rowCount ? String(r.rows[0].author_id) : null;
}

/* -------------------------------- votes ------------------------------ */

/**
 * Cast (or clear) a vote and recompute the subject's denormalised score in the
 * SAME transaction, so score can never drift from the votes table. `value` 0
 * clears. Returns the new score and the viewer's resulting vote.
 */
export async function vote(
  subjectType: VoteSubject,
  subjectId: string,
  userId: string,
  value: number,
): Promise<{ ok: true; score: number; myVote: number } | { ok: false; error: string }> {
  if (!pool) return { ok: false, error: "forum disabled" };
  const v = value > 0 ? 1 : value < 0 ? -1 : 0;
  const table = subjectType === "post" ? "posts" : "post_answers";

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const exists = await client.query(`SELECT 1 FROM ${table} WHERE id = $1`, [subjectId]);
    if (!exists.rowCount) {
      await client.query("ROLLBACK");
      return { ok: false, error: "not found" };
    }
    if (v === 0) {
      await client.query(
        `DELETE FROM votes WHERE subject_type = $1 AND subject_id = $2 AND user_id = $3`,
        [subjectType, subjectId, userId],
      );
    } else {
      await client.query(
        `INSERT INTO votes (subject_type, subject_id, user_id, value) VALUES ($1, $2, $3, $4)
         ON CONFLICT (subject_type, subject_id, user_id) DO UPDATE SET value = EXCLUDED.value`,
        [subjectType, subjectId, userId, v],
      );
    }
    const sum = await client.query(
      `SELECT COALESCE(sum(value), 0) AS s FROM votes WHERE subject_type = $1 AND subject_id = $2`,
      [subjectType, subjectId],
    );
    const score = Number(sum.rows[0].s);
    await client.query(`UPDATE ${table} SET score = $2 WHERE id = $1`, [subjectId, score]);
    await client.query("COMMIT");
    return { ok: true, score, myVote: v };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/* -------------------------------- karma ------------------------------ */

/**
 * Karma = net votes received on a user's posts + answers. Derived on read so
 * there is exactly ONE definition of it; cache if it ever gets hot.
 *
 * Note for anyone wiring this into ranking: karma is farmable in a way that
 * recorded outcomes are not. It is deliberately exposed as a plain number here
 * and bounded at the point of use (see KARMA_RANK_WEIGHT in index.ts), never
 * blended into trust inside this module.
 */
export async function karmaFor(userIds: string[]): Promise<Record<string, number>> {
  if (!pool || userIds.length === 0) return {};
  const r = await pool.query(
    `SELECT author_id, SUM(score)::int AS karma FROM (
        SELECT author_id, score FROM posts        WHERE author_id = ANY($1) AND NOT deleted
        UNION ALL
        SELECT author_id, score FROM post_answers WHERE author_id = ANY($1) AND NOT deleted
     ) x GROUP BY author_id`,
    [userIds],
  );
  const out: Record<string, number> = {};
  for (const row of r.rows) out[String(row.author_id)] = Number(row.karma ?? 0);
  return out;
}

/* ------------------------------ migration ---------------------------- */

/** Find-or-create a circle's default section, so migrated knowledge lands
 *  somewhere sensible instead of loose at the circle root. */
export async function ensureTopic(circleId: string, label: string, createdBy: string): Promise<string | null> {
  if (!pool) return null;
  const found = await pool.query(`SELECT id FROM circle_topics WHERE circle_id = $1 AND label = $2 LIMIT 1`, [
    circleId,
    label,
  ]);
  if (found.rowCount) return String(found.rows[0].id);
  const r = await createTopic({ circleId, label, createdBy });
  return r.ok ? r.id : null;
}

/**
 * Promote a room's saved answers into forum posts, preserving the original
 * author and date — this is the seeded Persian community knowledge and losing
 * attribution would be worse than losing the feature.
 *
 * Idempotent via `posts.migrated_from_answer` (partial unique index), so a
 * re-run is a no-op. Deliberately does NOT delete `room_answers`: the public
 * /a/<id> links are already shared in Telegram and must not 404.
 */
export async function migrateRoomAnswers(
  circleId: string,
  roomId: string,
  topicId: string | null,
): Promise<{ migrated: number; skipped: number }> {
  if (!pool) return { migrated: 0, skipped: 0 };
  const src = await pool.query(
    `SELECT id, author_id, body, created_at FROM room_answers WHERE room_id = $1 ORDER BY id`,
    [roomId],
  );
  let migrated = 0;
  let skipped = 0;
  for (const row of src.rows) {
    const body = String(row.body ?? "").trim();
    if (!body) {
      skipped++;
      continue;
    }
    // Saved answers have no title — take a readable first line, keep the full
    // text as the body so nothing is truncated away.
    const firstLine = body.split(/\n/)[0].trim();
    const title = (firstLine.length > 90 ? `${firstLine.slice(0, 90)}…` : firstLine) || body.slice(0, 90);
    const r = await createPost({
      circleId,
      topicId,
      authorId: String(row.author_id),
      title,
      body,
      createdAt: new Date(row.created_at).toISOString(),
      migratedFromAnswer: Number(row.id),
    });
    if (r.ok) migrated++;
    else skipped++;
  }
  return { migrated, skipped };
}

/** Distinct people who have posted or answered in a circle — "N contributors". */
export async function circleContributors(circleId: string): Promise<string[]> {
  if (!pool) return [];
  const r = await pool.query(
    `SELECT DISTINCT author_id FROM (
        SELECT author_id, circle_id FROM posts WHERE NOT deleted
        UNION ALL
        SELECT a.author_id, p.circle_id FROM post_answers a JOIN posts p ON p.id = a.post_id WHERE NOT a.deleted
     ) x WHERE circle_id = $1`,
    [circleId],
  );
  return r.rows.map((row) => String(row.author_id));
}
