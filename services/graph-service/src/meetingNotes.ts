/**
 * Meeting notes (Trusty Sevan F5) — PRIVATE by design. Graph nodes are shared
 * in this architecture, so note text must never become a `thought` node: it
 * lives in Postgres, readable only by its author. Only the CONFIRMED extracted
 * entities enter the graph — as shared concept nodes + the author's own
 * user-scoped edges (see the /api/notes handler).
 *
 * Mirrors asks.ts / meetings.ts: no-op without DATABASE_URL.
 */
import pg from "pg";
import type { ThoughtExtraction } from "@constellation/graph-core";

const DATABASE_URL = process.env.DATABASE_URL?.trim();
let pool: pg.Pool | null = null;

export function notesEnabled(): boolean {
  return !!pool;
}

export async function initMeetingNotes(): Promise<void> {
  if (!DATABASE_URL) {
    console.warn("graph-service: DATABASE_URL not set — meeting notes disabled");
    return;
  }
  const p = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
  await p.query(`
    CREATE TABLE IF NOT EXISTS meeting_notes (
      id          BIGSERIAL PRIMARY KEY,
      author_id   TEXT NOT NULL,
      target_id   TEXT NOT NULL,
      text        TEXT NOT NULL,
      extraction  JSONB,
      visibility  TEXT NOT NULL DEFAULT 'private',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  // Existing installs predate visibility/updated_at/photos.
  await p.query(`ALTER TABLE meeting_notes ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private'`);
  await p.query(`ALTER TABLE meeting_notes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`);
  await p.query(`ALTER TABLE meeting_notes ADD COLUMN IF NOT EXISTS photos JSONB`);
  await p.query(
    `CREATE INDEX IF NOT EXISTS meeting_notes_pair_idx ON meeting_notes(author_id, target_id, created_at DESC)`,
  );
  await p.query(
    `CREATE INDEX IF NOT EXISTS meeting_notes_target_idx ON meeting_notes(target_id, created_at DESC)`,
  );
  pool = p;
  console.log("graph-service: meeting notes ready (postgres)");
}

export const NOTE_VISIBILITIES = ["private", "connections", "public"] as const;
export type NoteVisibility = (typeof NOTE_VISIBILITIES)[number];

export function normalizeVisibility(v: unknown): NoteVisibility {
  return (NOTE_VISIBILITIES as readonly string[]).includes(String(v)) ? (String(v) as NoteVisibility) : "private";
}

export interface MeetingNote {
  id: string;
  authorId: string;
  targetId: string;
  text: string;
  extraction?: ThoughtExtraction;
  visibility: NoteVisibility;
  /** Attached image URLs (BFF uploads volume). */
  photos?: string[];
  createdAt: string;
  updatedAt: string;
}

function row(r: Record<string, unknown>): MeetingNote {
  return {
    id: String(r.id),
    authorId: String(r.author_id),
    targetId: String(r.target_id),
    text: String(r.text),
    extraction: (r.extraction ?? undefined) as ThoughtExtraction | undefined,
    visibility: normalizeVisibility(r.visibility),
    photos: Array.isArray(r.photos) && r.photos.length ? (r.photos as string[]).map(String) : undefined,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at ?? r.created_at),
  };
}

const cleanPhotos = (v: unknown): string[] | null =>
  Array.isArray(v) ? v.map(String).filter((u) => u.startsWith("/")).slice(0, 6) : null;

export async function createNote(input: {
  authorId: string;
  targetId: string;
  text: string;
  extraction?: ThoughtExtraction;
  visibility?: NoteVisibility;
  photos?: string[];
}): Promise<MeetingNote> {
  if (!pool) throw new Error("meeting notes disabled");
  const r = await pool.query(
    `INSERT INTO meeting_notes (author_id, target_id, text, extraction, visibility, photos)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [
      input.authorId,
      input.targetId,
      input.text,
      input.extraction ? JSON.stringify(input.extraction) : null,
      normalizeVisibility(input.visibility),
      input.photos?.length ? JSON.stringify(cleanPhotos(input.photos)) : null,
    ],
  );
  return row(r.rows[0]);
}

/** Update a note (author-only). Returns null when it isn't theirs. */
export async function updateNote(
  id: string,
  authorId: string,
  patch: { text?: string; extraction?: ThoughtExtraction; visibility?: NoteVisibility; photos?: string[] },
): Promise<MeetingNote | null> {
  if (!pool) throw new Error("meeting notes disabled");
  const r = await pool.query(
    `UPDATE meeting_notes SET
       text = COALESCE($3, text),
       extraction = COALESCE($4, extraction),
       visibility = COALESCE($5, visibility),
       photos = COALESCE($6, photos),
       updated_at = now()
     WHERE id=$1 AND author_id=$2 RETURNING *`,
    [
      id,
      authorId,
      patch.text ?? null,
      patch.extraction ? JSON.stringify(patch.extraction) : null,
      patch.visibility ? normalizeVisibility(patch.visibility) : null,
      patch.photos ? JSON.stringify(cleanPhotos(patch.photos)) : null,
    ],
  );
  return r.rows[0] ? row(r.rows[0]) : null;
}

/** Delete a note (author-only). Returns the deleted note or null. */
export async function deleteNote(id: string, authorId: string): Promise<MeetingNote | null> {
  if (!pool) throw new Error("meeting notes disabled");
  const r = await pool.query(`DELETE FROM meeting_notes WHERE id=$1 AND author_id=$2 RETURNING *`, [id, authorId]);
  return r.rows[0] ? row(r.rows[0]) : null;
}

/** The author's notes about one person — private to the author. */
export async function notesForPair(authorId: string, targetId: string): Promise<MeetingNote[]> {
  if (!pool) return [];
  const r = await pool.query(
    `SELECT * FROM meeting_notes WHERE author_id=$1 AND target_id=$2 ORDER BY created_at DESC LIMIT 50`,
    [authorId, targetId],
  );
  return r.rows.map(row);
}

/** All of one author's notes (the journal). */
export async function notesByAuthor(authorId: string): Promise<MeetingNote[]> {
  if (!pool) return [];
  const r = await pool.query(
    `SELECT * FROM meeting_notes WHERE author_id=$1 ORDER BY created_at DESC LIMIT 200`,
    [authorId],
  );
  return r.rows.map(row);
}

/** Every note about a person, all visibilities — the HANDLER applies the
 *  audience filter (public / author's-connections / own). */
export async function notesAbout(targetId: string): Promise<MeetingNote[]> {
  if (!pool) return [];
  const r = await pool.query(
    `SELECT * FROM meeting_notes WHERE target_id=$1 ORDER BY created_at DESC LIMIT 100`,
    [targetId],
  );
  return r.rows.map(row);
}
