/**
 * Specialist platform service layer (#38/#39).
 *
 * Entity ≠ account: the graph node stays the public identity; these tables
 * carry lifecycle + management authority + layered provider fields. Managers
 * live in Postgres (private authorization data), NOT as graph edges.
 *
 * Event-sourced like journeys/contribution: `specialist_events` is the
 * append-only source of truth; `specialist_profiles.state` is a derived
 * cache. The independent-evidence layer is never stored here — the routes
 * compute it from recommendations/outcomes on read, so it is structurally
 * un-editable by the specialist.
 *
 * Mirrors journeys.ts; no-op without DATABASE_URL.
 */
import pg from "pg";
import {
  canTransitionSpecialist,
  invalidProviderField,
  applyProviderPatch,
  validateClaimEvidence,
  MANAGER_PERMISSIONS,
  SPECIALIST_MANAGER_ROLES,
  type SpecialistClaimEvidence,
  type SpecialistEventKind,
  type SpecialistLayerName,
  type SpecialistLayers,
  type SpecialistManagerRole,
  type SpecialistPermissions,
  type SpecialistState,
} from "@constellation/graph-core";

const DATABASE_URL = process.env.DATABASE_URL?.trim();
let pool: pg.Pool | null = null;

export function specialistsEnabled(): boolean {
  return !!pool;
}

export async function initSpecialists(): Promise<void> {
  if (!DATABASE_URL) {
    console.warn("graph-service: DATABASE_URL not set — specialists disabled");
    return;
  }
  const p = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
  await p.query(`
    CREATE TABLE IF NOT EXISTS specialist_profiles (
      node_id     TEXT PRIMARY KEY,
      state       TEXT NOT NULL DEFAULT 'unclaimed',   -- derived cache of specialist_events
      layers      JSONB NOT NULL DEFAULT '{}',          -- layered fields, each {value, source, updatedAt}
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await p.query(`
    CREATE TABLE IF NOT EXISTS specialist_events (
      id          BIGSERIAL PRIMARY KEY,
      node_id     TEXT NOT NULL,
      actor       TEXT NOT NULL,
      kind        TEXT NOT NULL,
      detail      JSONB,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await p.query(`CREATE INDEX IF NOT EXISTS specialist_events_idx ON specialist_events(node_id, created_at)`);
  await p.query(`
    CREATE TABLE IF NOT EXISTS specialist_managers (
      node_id     TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      role        TEXT NOT NULL,
      added_by    TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (node_id, user_id)
    )`);
  await p.query(`
    CREATE TABLE IF NOT EXISTS specialist_claims (
      id          BIGSERIAL PRIMARY KEY,
      node_id     TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      evidence    JSONB NOT NULL,
      status      TEXT NOT NULL DEFAULT 'pending',      -- pending | approved | rejected
      reason      TEXT,
      decided_by  TEXT,
      decided_at  TIMESTAMPTZ,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await p.query(`CREATE INDEX IF NOT EXISTS specialist_claims_idx ON specialist_claims(status, created_at DESC)`);
  await p.query(`CREATE INDEX IF NOT EXISTS specialist_claims_node_idx ON specialist_claims(node_id, user_id)`);
  pool = p;
  console.log("graph-service: specialists ready (postgres)");
}

/* ------------------------------ helpers ---------------------------- */

async function appendEvent(
  client: pg.PoolClient | pg.Pool,
  nodeId: string,
  actor: string,
  kind: SpecialistEventKind,
  detail?: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `INSERT INTO specialist_events (node_id, actor, kind, detail) VALUES ($1, $2, $3, $4)`,
    [nodeId, actor, kind, detail ? JSON.stringify(detail) : null],
  );
}

async function setState(
  client: pg.PoolClient | pg.Pool,
  nodeId: string,
  state: SpecialistState,
): Promise<void> {
  await client.query(
    `UPDATE specialist_profiles SET state = $2, updated_at = now() WHERE node_id = $1`,
    [nodeId, state],
  );
}

/** Create the profile row lazily the first time a professional node is touched. */
export async function ensureSpecialist(nodeId: string): Promise<{ state: SpecialistState; layers: SpecialistLayers }> {
  if (!pool) throw new Error("specialists disabled");
  const r = await pool.query(
    `INSERT INTO specialist_profiles (node_id) VALUES ($1)
     ON CONFLICT (node_id) DO UPDATE SET node_id = EXCLUDED.node_id
     RETURNING state, layers`,
    [nodeId],
  );
  return { state: r.rows[0].state as SpecialistState, layers: (r.rows[0].layers ?? {}) as SpecialistLayers };
}

/* ------------------------------ reads ------------------------------ */

export interface SpecialistManagerRow {
  userId: string;
  role: SpecialistManagerRole;
  addedBy: string;
  createdAt: string;
}

export async function managersFor(nodeId: string): Promise<SpecialistManagerRow[]> {
  if (!pool) return [];
  const r = await pool.query(
    `SELECT user_id, role, added_by, created_at FROM specialist_managers WHERE node_id = $1 ORDER BY created_at`,
    [nodeId],
  );
  return r.rows.map((row) => ({
    userId: String(row.user_id),
    role: row.role as SpecialistManagerRole,
    addedBy: String(row.added_by),
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

export async function permissionsFor(nodeId: string, userId: string): Promise<SpecialistPermissions | null> {
  if (!pool) return null;
  const r = await pool.query(
    `SELECT role FROM specialist_managers WHERE node_id = $1 AND user_id = $2`,
    [nodeId, userId],
  );
  if (!r.rowCount) return null;
  return MANAGER_PERMISSIONS[r.rows[0].role as SpecialistManagerRole] ?? null;
}

export interface SpecialistView {
  nodeId: string;
  state: SpecialistState;
  layers: SpecialistLayers;
  /** viewer-specific */
  isManager: boolean;
  permissions: SpecialistPermissions | null;
  /** the viewer's own pending claim, if any */
  pendingClaim: boolean;
  managers?: SpecialistManagerRow[];
  createdAt: string;
  updatedAt: string;
}

export async function getSpecialist(nodeId: string, viewerId: string, viewerIsAdmin: boolean): Promise<SpecialistView> {
  if (!pool) throw new Error("specialists disabled");
  await ensureSpecialist(nodeId);
  const r = await pool.query(
    `SELECT state, layers, created_at, updated_at FROM specialist_profiles WHERE node_id = $1`,
    [nodeId],
  );
  const row = r.rows[0];
  const permissions = await permissionsFor(nodeId, viewerId);
  const pending = await pool.query(
    `SELECT 1 FROM specialist_claims WHERE node_id = $1 AND user_id = $2 AND status = 'pending' LIMIT 1`,
    [nodeId, viewerId],
  );
  const view: SpecialistView = {
    nodeId,
    state: row.state as SpecialistState,
    layers: (row.layers ?? {}) as SpecialistLayers,
    isManager: !!permissions,
    permissions,
    pendingClaim: !!pending.rowCount,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
  // The manager list is private authorization data — managers + admins only.
  if (permissions?.manageManagers || viewerIsAdmin) view.managers = await managersFor(nodeId);
  return view;
}

/** Bulk state lookup for UI badges (catalog cards, admin lists). */
export async function specialistStates(nodeIds: string[]): Promise<Record<string, SpecialistState>> {
  if (!pool || nodeIds.length === 0) return {};
  const r = await pool.query(
    `SELECT node_id, state FROM specialist_profiles WHERE node_id = ANY($1)`,
    [nodeIds],
  );
  const out: Record<string, SpecialistState> = {};
  for (const row of r.rows) out[String(row.node_id)] = row.state as SpecialistState;
  return out;
}

/* ------------------------------ claims ----------------------------- */

export async function submitClaim(
  nodeId: string,
  userId: string,
  evidence: SpecialistClaimEvidence,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!pool) return { ok: false, error: "specialists disabled" };
  const invalid = validateClaimEvidence(evidence);
  if (invalid) return { ok: false, error: invalid };
  const { state } = await ensureSpecialist(nodeId);
  if (await permissionsFor(nodeId, userId)) return { ok: false, error: "you already manage this profile" };
  if (!canTransitionSpecialist(state, "claim_requested") && state !== "claim_requested" && state !== "claim_under_review") {
    return { ok: false, error: `profile is not claimable in state "${state}"` };
  }
  const dup = await pool.query(
    `SELECT 1 FROM specialist_claims WHERE node_id = $1 AND user_id = $2 AND status = 'pending' LIMIT 1`,
    [nodeId, userId],
  );
  if (dup.rowCount) return { ok: false, error: "you already have a pending claim for this profile" };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO specialist_claims (node_id, user_id, evidence) VALUES ($1, $2, $3)`,
      [nodeId, userId, JSON.stringify(evidence)],
    );
    await appendEvent(client, nodeId, userId, "claim_submitted", {
      anchors: Object.keys(evidence).filter((k) => !!(evidence as Record<string, unknown>)[k]),
    });
    if (state === "unclaimed" || state === "claim_rejected") await setState(client, nodeId, "claim_requested");
    await client.query("COMMIT");
    return { ok: true };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export interface ClaimRow {
  id: string;
  nodeId: string;
  userId: string;
  evidence: SpecialistClaimEvidence;
  status: "pending" | "approved" | "rejected";
  reason: string | null;
  createdAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
}

export async function listClaims(status?: string): Promise<ClaimRow[]> {
  if (!pool) return [];
  const r = status
    ? await pool.query(`SELECT * FROM specialist_claims WHERE status = $1 ORDER BY created_at DESC LIMIT 200`, [status])
    : await pool.query(`SELECT * FROM specialist_claims ORDER BY created_at DESC LIMIT 200`);
  return r.rows.map((row) => ({
    id: String(row.id),
    nodeId: String(row.node_id),
    userId: String(row.user_id),
    evidence: row.evidence as SpecialistClaimEvidence,
    status: row.status,
    reason: row.reason ?? null,
    createdAt: new Date(row.created_at).toISOString(),
    decidedBy: row.decided_by ?? null,
    decidedAt: row.decided_at ? new Date(row.decided_at).toISOString() : null,
  }));
}

export async function reviewClaim(
  claimId: string,
  adminId: string,
  approve: boolean,
  reason?: string,
): Promise<{ ok: true; nodeId: string } | { ok: false; error: string }> {
  if (!pool) return { ok: false, error: "specialists disabled" };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query(`SELECT * FROM specialist_claims WHERE id = $1 FOR UPDATE`, [claimId]);
    if (!r.rowCount) {
      await client.query("ROLLBACK");
      return { ok: false, error: "claim not found" };
    }
    const claim = r.rows[0];
    if (claim.status !== "pending") {
      await client.query("ROLLBACK");
      return { ok: false, error: `claim already ${claim.status}` };
    }
    const nodeId = String(claim.node_id);
    await client.query(
      `UPDATE specialist_claims SET status = $2, reason = $3, decided_by = $4, decided_at = now() WHERE id = $1`,
      [claimId, approve ? "approved" : "rejected", reason ?? null, adminId],
    );
    await appendEvent(client, nodeId, adminId, "claim_review_started", { claimId });
    if (approve) {
      // First approved manager becomes owner; later approvals join as profile managers.
      const existing = await client.query(`SELECT 1 FROM specialist_managers WHERE node_id = $1 LIMIT 1`, [nodeId]);
      const role: SpecialistManagerRole = existing.rowCount ? "profile_manager" : "owner";
      await client.query(
        `INSERT INTO specialist_managers (node_id, user_id, role, added_by)
         VALUES ($1, $2, $3, $4) ON CONFLICT (node_id, user_id) DO NOTHING`,
        [nodeId, String(claim.user_id), role, adminId],
      );
      await appendEvent(client, nodeId, adminId, "claim_approved", { claimId, userId: String(claim.user_id), role });
      await appendEvent(client, nodeId, adminId, "manager_added", { userId: String(claim.user_id), role });
      await setState(client, nodeId, "claimed");
    } else {
      await appendEvent(client, nodeId, adminId, "claim_rejected", { claimId, reason: reason ?? null });
      // Only fall back to claim_rejected if nobody else manages the profile.
      const managed = await client.query(`SELECT 1 FROM specialist_managers WHERE node_id = $1 LIMIT 1`, [nodeId]);
      if (!managed.rowCount) await setState(client, nodeId, "claim_rejected");
    }
    await client.query("COMMIT");
    return { ok: true, nodeId };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/* --------------------------- provider edits ------------------------ */

export async function updateProfileFields(
  nodeId: string,
  userId: string,
  layer: SpecialistLayerName,
  fields: Record<string, unknown>,
): Promise<{ ok: true; layers: SpecialistLayers } | { ok: false; error: string }> {
  if (!pool) return { ok: false, error: "specialists disabled" };
  const perms = await permissionsFor(nodeId, userId);
  if (!perms?.editProfile) return { ok: false, error: "not a profile manager" };
  const bad = invalidProviderField(layer, fields);
  if (bad) return { ok: false, error: `field not editable: ${bad}` };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query(`SELECT layers FROM specialist_profiles WHERE node_id = $1 FOR UPDATE`, [nodeId]);
    if (!r.rowCount) {
      await client.query("ROLLBACK");
      return { ok: false, error: "specialist profile not found" };
    }
    const layers = (r.rows[0].layers ?? {}) as SpecialistLayers;
    layers[layer] = applyProviderPatch(layers[layer], fields, "specialist_provided", new Date().toISOString());
    await client.query(
      `UPDATE specialist_profiles SET layers = $2, updated_at = now() WHERE node_id = $1`,
      [nodeId, JSON.stringify(layers)],
    );
    await appendEvent(client, nodeId, userId, "field_updated", { layer, fields: Object.keys(fields) });
    await client.query("COMMIT");
    return { ok: true, layers };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/* ------------------------------ managers --------------------------- */

export async function addManager(
  nodeId: string,
  actorId: string,
  targetUserId: string,
  role: SpecialistManagerRole,
  actorIsAdmin: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!pool) return { ok: false, error: "specialists disabled" };
  if (!SPECIALIST_MANAGER_ROLES.includes(role)) return { ok: false, error: "unknown role" };
  const perms = await permissionsFor(nodeId, actorId);
  if (!perms?.manageManagers && !actorIsAdmin) return { ok: false, error: "not allowed to manage managers" };
  await pool.query(
    `INSERT INTO specialist_managers (node_id, user_id, role, added_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (node_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
    [nodeId, targetUserId, role, actorId],
  );
  await appendEvent(pool, nodeId, actorId, "manager_added", { userId: targetUserId, role });
  return { ok: true };
}

export async function removeManager(
  nodeId: string,
  actorId: string,
  targetUserId: string,
  actorIsAdmin: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!pool) return { ok: false, error: "specialists disabled" };
  const perms = await permissionsFor(nodeId, actorId);
  if (!perms?.manageManagers && !actorIsAdmin) return { ok: false, error: "not allowed to manage managers" };
  const owners = await pool.query(
    `SELECT user_id FROM specialist_managers WHERE node_id = $1 AND role = 'owner'`,
    [nodeId],
  );
  if (owners.rowCount === 1 && String(owners.rows[0].user_id) === targetUserId && !actorIsAdmin) {
    return { ok: false, error: "cannot remove the last owner" };
  }
  await pool.query(`DELETE FROM specialist_managers WHERE node_id = $1 AND user_id = $2`, [nodeId, targetUserId]);
  await appendEvent(pool, nodeId, actorId, "manager_removed", { userId: targetUserId });
  return { ok: true };
}

/* ------------------------------ timeline --------------------------- */

export interface SpecialistEventRow {
  id: string;
  actor: string;
  kind: SpecialistEventKind;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

/** Audit timeline — managers and admins only (enforced by the route). */
export async function specialistTimeline(nodeId: string, limit = 50): Promise<SpecialistEventRow[]> {
  if (!pool) return [];
  const r = await pool.query(
    `SELECT id, actor, kind, detail, created_at FROM specialist_events
     WHERE node_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [nodeId, limit],
  );
  return r.rows.map((row) => ({
    id: String(row.id),
    actor: String(row.actor),
    kind: row.kind as SpecialistEventKind,
    detail: (row.detail ?? null) as Record<string, unknown> | null,
    createdAt: new Date(row.created_at).toISOString(),
  }));
}
