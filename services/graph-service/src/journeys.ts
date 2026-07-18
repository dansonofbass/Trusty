/**
 * Decision Journeys (#35) — the decision, not the search, is the unit.
 *
 * Evidence-first storage, like the rest of the platform: `journey_events` is
 * the append-only source of truth; the `journeys` row caches the merged
 * context/status/title for cheap listing but can always be rebuilt from the
 * log (graph-core `contextFromEvents` / `deriveJourneyStatus`).
 *
 * A journey begins automatically when a decision-shaped interaction happens
 * (`autoJourney` — called by the composer agent's trust_search) and continues
 * as long as the topic matches; refinements merge into context, never restart.
 * Mirrors asks.ts; no-op without DATABASE_URL.
 */
import pg from "pg";
import {
  deriveJourneyStatus,
  deriveRecStates,
  journeyMatches,
  mergeJourneyContext,
  type JourneyContext,
  type JourneyEvent,
  type JourneyEventKind,
  type JourneyRecState,
  type JourneyStatus,
} from "@constellation/graph-core";

const DATABASE_URL = process.env.DATABASE_URL?.trim();
let pool: pg.Pool | null = null;

export function journeysEnabled(): boolean {
  return !!pool;
}

export async function initJourneys(): Promise<void> {
  if (!DATABASE_URL) {
    console.warn("graph-service: DATABASE_URL not set — journeys disabled");
    return;
  }
  const p = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
  await p.query(`
    CREATE TABLE IF NOT EXISTS journeys (
      id          BIGSERIAL PRIMARY KEY,
      user_id     TEXT NOT NULL,
      title       TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'open',  -- open | decided | completed | closed (derived cache)
      context     JSONB NOT NULL,                -- merged JourneyContext (derived cache)
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await p.query(`CREATE INDEX IF NOT EXISTS journeys_user_idx ON journeys(user_id, updated_at DESC)`);
  await p.query(`
    CREATE TABLE IF NOT EXISTS journey_events (
      id          BIGSERIAL PRIMARY KEY,
      journey_id  BIGINT NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
      kind        TEXT NOT NULL,
      detail      JSONB,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await p.query(`CREATE INDEX IF NOT EXISTS journey_events_idx ON journey_events(journey_id, created_at)`);
  pool = p;
  console.log("graph-service: journeys ready (postgres)");
}

export interface JourneySummary {
  id: string;
  title: string;
  status: JourneyStatus;
  context: JourneyContext;
  createdAt: string;
  updatedAt: string;
}

export interface JourneyDetail extends JourneySummary {
  events: (JourneyEvent & { id: string })[];
  recStates: Record<string, JourneyRecState>;
}

const emptyContext = (topic: string): JourneyContext => ({
  topic,
  preferences: [],
  constraints: [],
});

function rowToSummary(row: Record<string, unknown>): JourneySummary {
  const raw = (row.context ?? {}) as Partial<JourneyContext>;
  return {
    id: String(row.id),
    title: row.title as string,
    status: (row.status as JourneyStatus) ?? "open",
    context: {
      ...emptyContext(raw.topic ?? "unknown"),
      ...raw,
      preferences: Array.isArray(raw.preferences) ? raw.preferences : [],
      constraints: Array.isArray(raw.constraints) ? raw.constraints : [],
    },
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  };
}

/** The viewer's journeys, newest first. */
export async function listJourneys(
  userId: string,
  status?: JourneyStatus | "active",
): Promise<JourneySummary[]> {
  if (!pool) return [];
  const filter =
    status === "active"
      ? `AND status IN ('open','decided')`
      : status
        ? `AND status = $2`
        : "";
  const params: unknown[] = [userId];
  if (status && status !== "active") params.push(status);
  const r = await pool.query(
    `SELECT * FROM journeys WHERE user_id = $1 ${filter} ORDER BY updated_at DESC LIMIT 50`,
    params,
  );
  return r.rows.map(rowToSummary);
}

export async function getJourney(userId: string, id: string): Promise<JourneyDetail | null> {
  if (!pool) return null;
  const r = await pool.query(`SELECT * FROM journeys WHERE id = $1 AND user_id = $2`, [id, userId]);
  if (!r.rows[0]) return null;
  const ev = await pool.query(
    `SELECT id, kind, detail, created_at FROM journey_events WHERE journey_id = $1 ORDER BY created_at, id`,
    [id],
  );
  const events = ev.rows.map((row) => ({
    id: String(row.id),
    kind: row.kind as JourneyEventKind,
    at: (row.created_at as Date).getTime(),
    detail: (row.detail ?? undefined) as JourneyEvent["detail"],
  }));
  const recStates: Record<string, JourneyRecState> = {};
  for (const [k, v] of deriveRecStates(events)) recStates[k] = v;
  return { ...rowToSummary(r.rows[0]), events, recStates };
}

/** Append an event and refresh the row's derived caches, in one transaction. */
export async function appendJourneyEvent(
  userId: string,
  journeyId: string,
  kind: JourneyEventKind,
  detail?: JourneyEvent["detail"],
): Promise<JourneySummary | null> {
  if (!pool) return null;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query(
      `SELECT * FROM journeys WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [journeyId, userId],
    );
    if (!r.rows[0]) {
      await client.query("ROLLBACK");
      return null;
    }
    const current = rowToSummary(r.rows[0]);
    await client.query(
      `INSERT INTO journey_events (journey_id, kind, detail) VALUES ($1, $2, $3)`,
      [journeyId, kind, detail ? JSON.stringify(detail) : null],
    );
    const context =
      kind === "context" && detail?.patch
        ? mergeJourneyContext(current.context, detail.patch)
        : current.context;
    // Status derives from the full log — cheap enough at journey scale.
    const ev = await client.query(
      `SELECT kind FROM journey_events WHERE journey_id = $1 ORDER BY created_at, id`,
      [journeyId],
    );
    const status = deriveJourneyStatus(
      ev.rows.map((row) => ({ kind: row.kind as JourneyEventKind, at: 0 })),
    );
    const upd = await client.query(
      `UPDATE journeys SET context = $2, status = $3, updated_at = now() WHERE id = $1 RETURNING *`,
      [journeyId, JSON.stringify(context), status],
    );
    await client.query("COMMIT");
    return rowToSummary(upd.rows[0]);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function createJourney(
  userId: string,
  input: { title?: string; topic: string; geo?: string; goal?: string },
): Promise<JourneySummary> {
  if (!pool) throw new Error("journeys unavailable");
  const context = mergeJourneyContext(emptyContext(input.topic), {
    geo: input.geo,
    goal: input.goal,
  });
  const title =
    input.title?.trim().slice(0, 120) ||
    `${input.topic.replace(/_/g, " ")}${input.geo ? ` in ${input.geo}` : ""}`;
  const r = await pool.query(
    `INSERT INTO journeys (user_id, title, context) VALUES ($1, $2, $3) RETURNING *`,
    [userId, title, JSON.stringify(context)],
  );
  await pool.query(`INSERT INTO journey_events (journey_id, kind) VALUES ($1, 'created')`, [
    r.rows[0].id,
  ]);
  return rowToSummary(r.rows[0]);
}

/** Continue-or-create (#35: "every meaningful search creates or continues a
 *  journey"): the newest OPEN journey with a matching topic/geo continues;
 *  otherwise a journey is born. Returns the journey + whether it's new. */
export async function autoJourney(
  userId: string,
  input: { topic: string; geo?: string; goal?: string },
): Promise<{ journey: JourneySummary; created: boolean }> {
  if (!pool) throw new Error("journeys unavailable");
  const open = await listJourneys(userId, "open");
  const match = open.find((j) => journeyMatches(j.context, input.topic, input.geo));
  if (match) {
    // A new geo on a geo-less journey is a refinement, not a new journey.
    if (input.geo && !match.context.geo) {
      const updated = await appendJourneyEvent(userId, match.id, "context", {
        patch: { geo: input.geo },
      });
      return { journey: updated ?? match, created: false };
    }
    return { journey: match, created: false };
  }
  return { journey: await createJourney(userId, input), created: true };
}
