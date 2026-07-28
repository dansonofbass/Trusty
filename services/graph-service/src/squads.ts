/**
 * Squad peer confirmations (Seaside Summit demo) — the lightweight trust
 * example: anyone self-serves into a squad (MEMBER_OF edge, created in
 * index.ts where the graph lives); squadmates then CONFIRM each other's
 * membership. Confirmations are append-only attestations, not permissions —
 * a member card shows "confirmed by N squadmates".
 *
 * Mirrors asks.ts; no-op without DATABASE_URL.
 */
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL?.trim();
let pool: pg.Pool | null = null;

export function squadsEnabled(): boolean {
  return !!pool;
}

export async function initSquads(): Promise<void> {
  if (!DATABASE_URL) {
    console.warn("graph-service: DATABASE_URL not set — squad confirmations disabled");
    return;
  }
  const p = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
  await p.query(`
    CREATE TABLE IF NOT EXISTS squad_confirmations (
      id            BIGSERIAL PRIMARY KEY,
      squad_node_id TEXT NOT NULL,
      member_id     TEXT NOT NULL,
      confirmer_id  TEXT NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (squad_node_id, member_id, confirmer_id)
    )`);
  await p.query(`CREATE INDEX IF NOT EXISTS squad_confirmations_idx ON squad_confirmations(squad_node_id, member_id)`);
  pool = p;
  console.log("graph-service: squad confirmations ready (postgres)");
}

/** Record an attestation (idempotent). Self-confirmation is rejected. */
export async function confirmSquadmate(
  squadNodeId: string,
  memberId: string,
  confirmerId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!pool) return { ok: false, error: "squad confirmations disabled" };
  if (memberId === confirmerId) return { ok: false, error: "you can't confirm yourself" };
  await pool.query(
    `INSERT INTO squad_confirmations (squad_node_id, member_id, confirmer_id)
     VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [squadNodeId, memberId, confirmerId],
  );
  return { ok: true };
}

/** member id → distinct confirmer count for one squad. */
export async function confirmationCounts(squadNodeId: string): Promise<Record<string, number>> {
  if (!pool) return {};
  const r = await pool.query(
    `SELECT member_id, count(DISTINCT confirmer_id) AS n
       FROM squad_confirmations WHERE squad_node_id = $1 GROUP BY member_id`,
    [squadNodeId],
  );
  const out: Record<string, number> = {};
  for (const row of r.rows) out[String(row.member_id)] = Number(row.n);
  return out;
}

/** Which squadmates has this viewer already confirmed? */
export async function confirmedBy(squadNodeId: string, confirmerId: string): Promise<Set<string>> {
  if (!pool) return new Set();
  const r = await pool.query(
    `SELECT member_id FROM squad_confirmations WHERE squad_node_id = $1 AND confirmer_id = $2`,
    [squadNodeId, confirmerId],
  );
  return new Set(r.rows.map((row) => String(row.member_id)));
}
