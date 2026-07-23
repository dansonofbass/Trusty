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
  effectiveVerificationStatus,
  subscriptionEntitlements,
  dataSufficiency,
  INTELLIGENCE_MIN_GROUP,
  MANAGER_PERMISSIONS,
  SPECIALIST_MANAGER_ROLES,
  SPECIALIST_VERIFICATION_TYPES,
  type SpecialistClaimEvidence,
  type SpecialistEventKind,
  type SpecialistLayerName,
  type SpecialistLayers,
  type SpecialistManagerRole,
  type SpecialistPermissions,
  type SpecialistState,
  type SpecialistVerification,
  type SpecialistVerificationType,
  type Entitlement,
  type SubscriptionPlan,
  type SubscriptionState,
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
  await p.query(`
    CREATE TABLE IF NOT EXISTS specialist_verifications (
      id          BIGSERIAL PRIMARY KEY,
      node_id     TEXT NOT NULL,
      type        TEXT NOT NULL,
      what        TEXT NOT NULL,               -- exactly what was checked
      source      TEXT NOT NULL,               -- who/what confirmed it
      verified_by TEXT NOT NULL,               -- admin user id
      verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at  TIMESTAMPTZ,
      status      TEXT NOT NULL DEFAULT 'active'  -- active | revoked | uncertain (expired computed on read)
    )`);
  await p.query(`CREATE INDEX IF NOT EXISTS specialist_verifications_idx ON specialist_verifications(node_id, verified_at DESC)`);
  await p.query(`
    CREATE TABLE IF NOT EXISTS specialist_subscriptions (
      node_id     TEXT PRIMARY KEY,
      plan        TEXT NOT NULL DEFAULT 'free',
      state       TEXT NOT NULL DEFAULT 'none',
      granted_by  TEXT,
      ends_at     TIMESTAMPTZ,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
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

/** Bulk subscription lookup (admin lists). Expiry computed like getSubscription. */
export async function subscriptionStates(
  nodeIds: string[],
): Promise<Record<string, { plan: SubscriptionPlan; state: SubscriptionState }>> {
  if (!pool || nodeIds.length === 0) return {};
  const r = await pool.query(
    `SELECT node_id, plan, state, ends_at FROM specialist_subscriptions WHERE node_id = ANY($1)`,
    [nodeIds],
  );
  const out: Record<string, { plan: SubscriptionPlan; state: SubscriptionState }> = {};
  for (const row of r.rows) {
    let state = row.state as SubscriptionState;
    if (
      row.ends_at && Date.parse(String(row.ends_at)) < Date.now() &&
      (state === "active" || state === "trial" || state === "admin_granted" || state === "pilot_access")
    ) state = "expired";
    out[String(row.node_id)] = { plan: row.plan as SubscriptionPlan, state };
  }
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

/* ---------------------------- verifications ------------------------ */

export interface VerificationRow extends SpecialistVerification {
  id: string;
  verifiedBy: string;
}

/** Public list — expired computed at read so it never displays as current. */
export async function listVerifications(nodeId: string): Promise<VerificationRow[]> {
  if (!pool) return [];
  const r = await pool.query(
    `SELECT * FROM specialist_verifications WHERE node_id = $1 ORDER BY verified_at DESC`,
    [nodeId],
  );
  const now = Date.now();
  return r.rows.map((row) => {
    const base: VerificationRow = {
      id: String(row.id),
      type: row.type as SpecialistVerificationType,
      what: String(row.what),
      source: String(row.source),
      verifiedBy: String(row.verified_by),
      verifiedAt: new Date(row.verified_at).toISOString(),
      expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
      status: row.status,
    };
    return { ...base, status: effectiveVerificationStatus(base, now) };
  });
}

export async function addVerification(
  nodeId: string,
  adminId: string,
  input: { type: string; what: string; source: string; expiresAt?: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!pool) return { ok: false, error: "specialists disabled" };
  if (!(SPECIALIST_VERIFICATION_TYPES as string[]).includes(input.type)) {
    return { ok: false, error: `unknown verification type: ${input.type}` };
  }
  if (!input.what.trim() || !input.source.trim()) return { ok: false, error: "what and source required" };
  const expires = input.expiresAt ? new Date(input.expiresAt) : null;
  if (expires && Number.isNaN(expires.getTime())) return { ok: false, error: "invalid expiresAt" };

  const { state } = await ensureSpecialist(nodeId);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO specialist_verifications (node_id, type, what, source, verified_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [nodeId, input.type, input.what.trim(), input.source.trim(), adminId, expires],
    );
    await appendEvent(client, nodeId, adminId, "verification_added", {
      type: input.type, what: input.what.trim(), source: input.source.trim(),
    });
    // Verification lifts a claimed profile to verified; unclaimed profiles keep
    // their state (a registry check doesn't imply management authority).
    if (state === "claimed") await setState(client, nodeId, "verified");
    await client.query("COMMIT");
    return { ok: true };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function revokeVerification(
  nodeId: string,
  verificationId: string,
  adminId: string,
  reason?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!pool) return { ok: false, error: "specialists disabled" };
  const r = await pool.query(
    `UPDATE specialist_verifications SET status = 'revoked' WHERE id = $1 AND node_id = $2 RETURNING type`,
    [verificationId, nodeId],
  );
  if (!r.rowCount) return { ok: false, error: "verification not found" };
  await appendEvent(pool, nodeId, adminId, "verification_expired", {
    verificationId, revoked: true, reason: reason ?? null,
  });
  // If nothing active remains, drop verified → claimed.
  const active = (await listVerifications(nodeId)).some((v) => v.status === "active");
  if (!active) {
    const cur = await pool.query(`SELECT state FROM specialist_profiles WHERE node_id = $1`, [nodeId]);
    if (cur.rows[0]?.state === "verified") await setState(pool, nodeId, "claimed");
  }
  return { ok: true };
}

/* --------------------- subscription & intelligence ----------------- */

export interface SubscriptionView {
  plan: SubscriptionPlan;
  state: SubscriptionState;
  endsAt: string | null;
  entitlements: readonly Entitlement[];
}

/** Subscription lives OUTSIDE the trust profile. Nothing in trust/ranking
 *  reads this table — the dependency is one-directional by design (#40). */
export async function getSubscription(nodeId: string): Promise<SubscriptionView> {
  const none: SubscriptionView = { plan: "free", state: "none", endsAt: null, entitlements: [] };
  if (!pool) return none;
  const r = await pool.query(`SELECT plan, state, ends_at FROM specialist_subscriptions WHERE node_id = $1`, [nodeId]);
  if (!r.rowCount) return none;
  let state = r.rows[0].state as SubscriptionState;
  const endsAt = r.rows[0].ends_at ? new Date(r.rows[0].ends_at).toISOString() : null;
  if (endsAt && Date.parse(endsAt) < Date.now() && (state === "active" || state === "trial" || state === "admin_granted" || state === "pilot_access")) {
    state = "expired"; // computed at read; no cron
  }
  const plan = r.rows[0].plan as SubscriptionPlan;
  return { plan, state, endsAt, entitlements: subscriptionEntitlements(plan, state) };
}

export async function setSubscription(
  nodeId: string,
  adminId: string,
  input: { plan: string; state: string; endsAt?: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!pool) return { ok: false, error: "specialists disabled" };
  if (!["free", "professional"].includes(input.plan)) return { ok: false, error: "unknown plan" };
  const states = ["none", "trial", "active", "past_due", "paused", "cancelled", "expired", "admin_granted", "pilot_access"];
  if (!states.includes(input.state)) return { ok: false, error: "unknown subscription state" };
  const ends = input.endsAt ? new Date(input.endsAt) : null;
  if (ends && Number.isNaN(ends.getTime())) return { ok: false, error: "invalid endsAt" };
  await ensureSpecialist(nodeId);
  await pool.query(
    `INSERT INTO specialist_subscriptions (node_id, plan, state, granted_by, ends_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (node_id) DO UPDATE SET plan = $2, state = $3, granted_by = $4, ends_at = $5, updated_at = now()`,
    [nodeId, input.plan, input.state, adminId, ends],
  );
  // Logged as a provider-facing audit event; deliberately NOT a lifecycle
  // state_changed (subscription is not part of the trust-profile lifecycle).
  await appendEvent(pool, nodeId, adminId, "field_updated", {
    layer: "subscription", plan: input.plan, state: input.state, endsAt: input.endsAt ?? null,
  });
  return { ok: true };
}

export interface VisibilityStats {
  impressions: number;
  clicks: number;
  distinctUsers: number;
  intents: number;
  outcomesPositive: number;
  outcomesNegative: number;
  sufficiency: ReturnType<typeof dataSufficiency>;
  /** true when aggregates are hidden below the privacy threshold */
  suppressed: boolean;
}

/** Privacy-safe funnel aggregates (90 days). Below the k-anonymity minimum,
 *  numbers are zeroed and marked suppressed — one identifiable user must
 *  never be reconstructable from the dashboard (#40). */
export async function visibilityStats(nodeId: string): Promise<VisibilityStats> {
  const empty: VisibilityStats = {
    impressions: 0, clicks: 0, distinctUsers: 0, intents: 0,
    outcomesPositive: 0, outcomesNegative: 0, sufficiency: "insufficient", suppressed: true,
  };
  if (!pool) return empty;
  const ia = await pool.query(
    `SELECT
       count(*) FILTER (WHERE kind = 'impression') AS impressions,
       count(*) FILTER (WHERE kind = 'click') AS clicks,
       count(DISTINCT user_id) AS distinct_users
     FROM interaction_events
     WHERE node_id = $1 AND at > now() - interval '90 days'`,
    [nodeId],
  ).catch(() => null);
  // Intents = decision-intent prompts ("I'll try this" / contact actions);
  // outcomes = the authoritative trust log targeting this entity.
  const ip = await pool.query(
    `SELECT count(*) AS intents FROM outcome_prompts
     WHERE node_id = $1 AND created_at > now() - interval '90 days'`,
    [nodeId],
  ).catch(() => null);
  const oc = await pool.query(
    `SELECT
       count(*) FILTER (WHERE value > 0) AS pos,
       count(*) FILTER (WHERE value < 0) AS neg
     FROM trust_outcomes
     WHERE to_id = $1 AND at > now() - interval '90 days'`,
    [nodeId],
  ).catch(() => null);
  const impressions = Number(ia?.rows[0]?.impressions ?? 0);
  const clicks = Number(ia?.rows[0]?.clicks ?? 0);
  const distinctUsers = Number(ia?.rows[0]?.distinct_users ?? 0);
  const events = impressions + clicks;
  const sufficiency = dataSufficiency(distinctUsers, events);
  if (distinctUsers < INTELLIGENCE_MIN_GROUP) {
    return { ...empty, distinctUsers: 0, sufficiency: "insufficient", suppressed: true };
  }
  return {
    impressions,
    clicks,
    distinctUsers,
    intents: Number(ip?.rows[0]?.intents ?? 0),
    outcomesPositive: Number(oc?.rows[0]?.pos ?? 0),
    outcomesNegative: Number(oc?.rows[0]?.neg ?? 0),
    sufficiency,
    suppressed: false,
  };
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
