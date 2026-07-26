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
  // Personal Knowledge Workspace (#31): every writing is a private workspace
  // doc with a knowledge kind + organizational collections. Additive columns.
  await p.query(`ALTER TABLE writings ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'note'`);
  await p.query(`ALTER TABLE writings ADD COLUMN IF NOT EXISTS collections TEXT[] NOT NULL DEFAULT '{}'`);
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
  // Folders (agentic-ux P3): a real hierarchy over the workspace. Additive —
  // `collections[]` stays for back-compat and migrates lazily per user.
  await p.query(`
    CREATE TABLE IF NOT EXISTS folders (
      id          BIGSERIAL PRIMARY KEY,
      user_id     TEXT NOT NULL,
      name        TEXT NOT NULL,
      parent_id   BIGINT REFERENCES folders(id) ON DELETE CASCADE,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await p.query(`CREATE INDEX IF NOT EXISTS folders_user_idx ON folders(user_id, parent_id)`);
  await p.query(`ALTER TABLE writings ADD COLUMN IF NOT EXISTS folder_id BIGINT REFERENCES folders(id) ON DELETE SET NULL`);
  // Wikilinks (agentic-ux P4): [[targets]] parsed from doc bodies, resolved
  // to sibling docs or graph nodes. AI-suggested links (P5) reuse the table
  // with created_by='ai' + status='suggested'.
  await p.query(`
    CREATE TABLE IF NOT EXISTS writing_links (
      id          BIGSERIAL PRIMARY KEY,
      user_id     TEXT NOT NULL,
      writing_id  TEXT NOT NULL REFERENCES writings(id) ON DELETE CASCADE,
      target_kind TEXT NOT NULL,        -- writing | node
      target_id   TEXT NOT NULL,
      alias       TEXT NOT NULL,        -- the [[text]] as typed
      created_by  TEXT NOT NULL DEFAULT 'user',   -- user | ai
      status      TEXT NOT NULL DEFAULT 'confirmed', -- confirmed | suggested
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await p.query(`CREATE INDEX IF NOT EXISTS writing_links_writing_idx ON writing_links(writing_id)`);
  await p.query(`CREATE INDEX IF NOT EXISTS writing_links_target_idx ON writing_links(user_id, target_kind, target_id)`);
  pool = p;
  console.log("graph-service: writings log ready (postgres)");
}

/* ------------------------- wikilinks (P4) -------------------------- */

export const WIKILINK_RE = /\[\[([^\[\]]+)\]\]/g;

export interface ResolvedNodeRef {
  id: string;
  label: string;
  type?: string;
}

/** Re-derive a doc's confirmed user links from its body. [[Targets]] resolve
 *  first to the user's own docs (title match), then to graph nodes via the
 *  caller-supplied resolver. Unresolved targets stay plain text (phantom
 *  docs are a later nicety). AI suggestions are left untouched. */
export async function syncWikilinks(
  userId: string,
  writingId: string,
  body: string,
  resolveNode: (name: string) => ResolvedNodeRef | null,
): Promise<void> {
  if (!pool) return;
  const names = [...new Set([...body.matchAll(WIKILINK_RE)].map((m) => m[1].trim()).filter(Boolean))];
  const links: { kind: string; id: string; alias: string }[] = [];
  if (names.length) {
    const docs = await pool.query(
      `SELECT id, title FROM writings WHERE user_id = $1 AND id <> $2 AND title = ANY($3) LIMIT 100`,
      [userId, writingId, names],
    );
    const docByTitle = new Map(docs.rows.map((r) => [String(r.title), String(r.id)]));
    for (const name of names) {
      const docId = docByTitle.get(name);
      if (docId) {
        links.push({ kind: "writing", id: docId, alias: name });
        continue;
      }
      const node = resolveNode(name);
      if (node) links.push({ kind: "node", id: node.id, alias: name });
    }
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `DELETE FROM writing_links WHERE writing_id = $1 AND created_by = 'user'`,
      [writingId],
    );
    for (const l of links) {
      await client.query(
        `INSERT INTO writing_links (user_id, writing_id, target_kind, target_id, alias) VALUES ($1, $2, $3, $4, $5)`,
        [userId, writingId, l.kind, l.id, l.alias],
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export interface WritingLink {
  targetKind: "writing" | "node";
  targetId: string;
  alias: string;
  createdBy: string;
  status: string;
  /** resolved display title (docs only; node labels resolve in the route) */
  title?: string | null;
}

export interface Backlink {
  writingId: string;
  title: string | null;
  alias: string;
}

/** Outgoing links + incoming backlinks for a doc (all owner-scoped). */
export async function linksFor(
  userId: string,
  writingId: string,
): Promise<{ outgoing: WritingLink[]; backlinks: Backlink[] }> {
  if (!pool) return { outgoing: [], backlinks: [] };
  const out = await pool.query(
    `SELECT l.target_kind, l.target_id, l.alias, l.created_by, l.status, w.title
       FROM writing_links l
       LEFT JOIN writings w ON w.id = l.target_id AND l.target_kind = 'writing'
      WHERE l.writing_id = $1 AND l.user_id = $2
      ORDER BY l.id`,
    [writingId, userId],
  );
  const back = await pool.query(
    `SELECT l.writing_id, l.alias, w.title
       FROM writing_links l
       JOIN writings w ON w.id = l.writing_id
      WHERE l.user_id = $1 AND l.target_kind = 'writing' AND l.target_id = $2 AND l.status = 'confirmed'
      ORDER BY l.id DESC LIMIT 50`,
    [userId, writingId],
  );
  return {
    outgoing: out.rows.map((r) => ({
      targetKind: r.target_kind,
      targetId: String(r.target_id),
      alias: String(r.alias),
      createdBy: String(r.created_by),
      status: String(r.status),
      title: r.title ?? null,
    })),
    backlinks: back.rows.map((r) => ({
      writingId: String(r.writing_id),
      title: r.title ?? null,
      alias: String(r.alias),
    })),
  };
}

/* ------------------------- folders (P3) ---------------------------- */

export interface FolderRow {
  id: string;
  name: string;
  parentId: string | null;
}

/** List folders; on a user's FIRST touch, migrate legacy collections[] into
 *  top-level folders (docs land in their first collection's folder). */
export async function listFolders(userId: string): Promise<FolderRow[]> {
  if (!pool) return [];
  const existing = await pool.query(
    `SELECT id, name, parent_id FROM folders WHERE user_id = $1 ORDER BY name`,
    [userId],
  );
  if (existing.rowCount) {
    return existing.rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      parentId: r.parent_id ? String(r.parent_id) : null,
    }));
  }
  // One-time migration: collections → top-level folders.
  const cols = await pool.query(
    `SELECT DISTINCT unnest(collections) AS c FROM writings WHERE user_id = $1 ORDER BY c LIMIT 50`,
    [userId],
  );
  if (!cols.rowCount) return [];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out: FolderRow[] = [];
    for (const row of cols.rows) {
      const name = String(row.c);
      const f = await client.query(
        `INSERT INTO folders (user_id, name) VALUES ($1, $2) RETURNING id`,
        [userId, name],
      );
      const fid = String(f.rows[0].id);
      await client.query(
        `UPDATE writings SET folder_id = $3
         WHERE user_id = $1 AND folder_id IS NULL AND collections[1] = $2`,
        [userId, name, fid],
      );
      out.push({ id: fid, name, parentId: null });
    }
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function createFolder(
  userId: string,
  name: string,
  parentId?: string,
): Promise<FolderRow | null> {
  if (!pool) return null;
  const clean = name.trim().slice(0, 60);
  if (!clean) return null;
  if (parentId) {
    const p = await pool.query(`SELECT 1 FROM folders WHERE id = $1 AND user_id = $2`, [parentId, userId]);
    if (!p.rowCount) return null;
  }
  const r = await pool.query(
    `INSERT INTO folders (user_id, name, parent_id) VALUES ($1, $2, $3) RETURNING id`,
    [userId, clean, parentId ?? null],
  );
  return { id: String(r.rows[0].id), name: clean, parentId: parentId ?? null };
}

export async function renameFolder(userId: string, id: string, name: string): Promise<boolean> {
  if (!pool) return false;
  const clean = name.trim().slice(0, 60);
  if (!clean) return false;
  const r = await pool.query(
    `UPDATE folders SET name = $3 WHERE id = $1 AND user_id = $2`,
    [id, userId, clean],
  );
  return !!r.rowCount;
}

/** Delete a folder: child folders cascade; docs fall back to the root
 *  (folder_id SET NULL) — deleting a folder never deletes writing. */
export async function deleteFolder(userId: string, id: string): Promise<boolean> {
  if (!pool) return false;
  const r = await pool.query(`DELETE FROM folders WHERE id = $1 AND user_id = $2`, [id, userId]);
  return !!r.rowCount;
}

export async function moveWriting(userId: string, id: string, folderId: string | null): Promise<boolean> {
  if (!pool) return false;
  if (folderId) {
    const f = await pool.query(`SELECT 1 FROM folders WHERE id = $1 AND user_id = $2`, [folderId, userId]);
    if (!f.rowCount) return false;
  }
  const r = await pool.query(
    `UPDATE writings SET folder_id = $3, updated_at = now() WHERE id = $1 AND user_id = $2`,
    [id, userId, folderId],
  );
  return !!r.rowCount;
}

/** Workspace knowledge kinds (#31) — one editor, many kinds; extensible. */
export const WORKSPACE_KINDS = [
  "note",
  "experience",
  "recommendation_draft",
  "decision",
  "research",
] as const;
export type WorkspaceKind = (typeof WORKSPACE_KINDS)[number];

/** Save (or update) a draft writing — no events, just keeps the row fresh. */
export async function saveDraft(i: {
  id: string;
  userId: string;
  title?: string;
  body: string;
  extraction: ThoughtExtraction;
  kind?: WorkspaceKind;
  collections?: string[];
}): Promise<void> {
  if (!pool) return;
  // Never demote an already-woven writing back to draft.
  await pool
    .query(
      `INSERT INTO writings (id, user_id, title, body, extraction, status, kind, collections, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'draft', $6, $7, now())
       ON CONFLICT (id) DO UPDATE
         SET title = EXCLUDED.title, body = EXCLUDED.body, extraction = EXCLUDED.extraction,
             kind = EXCLUDED.kind, collections = EXCLUDED.collections,
             status = CASE WHEN writings.status = 'woven' THEN 'woven' ELSE 'draft' END,
             updated_at = now()`,
      [
        i.id,
        i.userId,
        i.title ?? null,
        i.body,
        JSON.stringify(i.extraction),
        i.kind ?? "note",
        i.collections ?? [],
      ],
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

/** Workspace listing (#31): owner-scoped, searchable, filterable. Private by
 *  construction — the query is always bound to the owner. */
export async function listWritings(
  userId: string,
  opts: { q?: string; kind?: string; collection?: string; folderId?: string } = {},
) {
  if (!pool) return [];
  const where: string[] = ["user_id = $1"];
  const params: unknown[] = [userId];
  if (opts.q) {
    params.push(`%${opts.q}%`);
    where.push(`(title ILIKE $${params.length} OR body ILIKE $${params.length})`);
  }
  if (opts.kind) {
    params.push(opts.kind);
    where.push(`kind = $${params.length}`);
  }
  if (opts.collection) {
    params.push(opts.collection);
    where.push(`$${params.length} = ANY(collections)`);
  }
  if (opts.folderId === "root") {
    where.push(`folder_id IS NULL`);
  } else if (opts.folderId) {
    params.push(opts.folderId);
    where.push(`folder_id = $${params.length}`);
  }
  const r = await pool.query(
    `SELECT id, thought_id, title, left(body, 200) AS snippet, status, kind, collections,
            folder_id AS "folderId", extraction->>'summary' AS summary, created_at, updated_at
       FROM writings WHERE ${where.join(" AND ")} ORDER BY updated_at DESC LIMIT 100`,
    params,
  );
  return r.rows.map((row) => ({ ...row, folderId: row.folderId ? String(row.folderId) : null }));
}

/** All collection names this user has used (for filter chips). */
export async function listCollections(userId: string): Promise<string[]> {
  if (!pool) return [];
  const r = await pool.query(
    `SELECT DISTINCT unnest(collections) AS c FROM writings WHERE user_id = $1 ORDER BY c LIMIT 50`,
    [userId],
  );
  return r.rows.map((row) => String(row.c));
}

/**
 * Edit a workspace doc (#31): the PREVIOUS body/title is captured as an
 * append-only `version` event BEFORE the update — every meaningful edit keeps
 * history, restorable later. Owner-scoped; never demotes a woven writing.
 */
export async function updateWriting(
  userId: string,
  id: string,
  patch: { title?: string; body?: string; kind?: WorkspaceKind; collections?: string[]; status?: "draft" | "published" },
): Promise<boolean> {
  if (!pool) return false;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const prev = await client.query(
      `SELECT title, body FROM writings WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [id, userId],
    );
    if (!prev.rows[0]) {
      await client.query("ROLLBACK");
      return false;
    }
    if (patch.body !== undefined && patch.body !== prev.rows[0].body) {
      await client.query(
        `INSERT INTO writing_events (writing_id, user_id, kind, detail) VALUES ($1, $2, 'version', $3)`,
        [id, userId, JSON.stringify({ title: prev.rows[0].title, body: prev.rows[0].body })],
      );
    }
    await client.query(
      `UPDATE writings SET
         title = COALESCE($3, title),
         body = COALESCE($4, body),
         kind = COALESCE($5, kind),
         collections = COALESCE($6, collections),
         status = CASE WHEN writings.status = 'woven' THEN 'woven' ELSE COALESCE($7, status) END,
         updated_at = now()
       WHERE id = $1 AND user_id = $2`,
      [id, userId, patch.title ?? null, patch.body ?? null, patch.kind ?? null, patch.collections ?? null, patch.status ?? null],
    );
    await client.query("COMMIT");
    return true;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("graph-service: updateWriting failed:", e instanceof Error ? e.message : e);
    return false;
  } finally {
    client.release();
  }
}

/** Delete a workspace doc (owner only). History goes with it (CASCADE). */
export async function deleteWriting(userId: string, id: string): Promise<boolean> {
  if (!pool) return false;
  const r = await pool.query(`DELETE FROM writings WHERE id = $1 AND user_id = $2`, [id, userId]);
  return (r.rowCount ?? 0) > 0;
}

/** Version history of one doc (owner only), oldest first. */
export async function writingVersions(userId: string, id: string) {
  if (!pool) return [];
  const r = await pool.query(
    `SELECT e.detail, e.at FROM writing_events e
      JOIN writings w ON w.id = e.writing_id AND w.user_id = $1
     WHERE e.writing_id = $2 AND e.kind = 'version' ORDER BY e.at ASC LIMIT 100`,
    [userId, id],
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
