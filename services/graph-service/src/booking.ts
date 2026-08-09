/**
 * Bookable sessions with specialists.
 *
 * v1 is free-to-book on purpose: the market-test survey is still measuring
 * willingness-to-pay, and proving people actually book is the cheaper
 * question. When payment lands, the seam is billing.ts's
 * createInvoice/markInvoicePaid — nothing here needs to change shape.
 *
 * Deliberately NOT built on meetings.ts: that models an event coffee-chat
 * handshake with a free-text `slot` and no availability, which is exactly the
 * "agree a time in DMs" problem this replaces.
 *
 * No-op without DATABASE_URL, like every module here.
 */
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL?.trim();
let pool: pg.Pool | null = null;

export function bookingEnabled(): boolean {
  return !!pool;
}

export type SlotStatus = "open" | "booked" | "cancelled";

export interface Slot {
  id: string;
  specialistNodeId: string;
  startsAt: string;
  endsAt: string;
  status: SlotStatus;
  /** Present only for the specialist's own view or the booker's. */
  bookedBy?: string;
  note?: string;
}

export async function initBooking(): Promise<void> {
  if (!DATABASE_URL) {
    console.warn("graph-service: DATABASE_URL not set — booking disabled");
    return;
  }
  const p = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
  await p.query(`
    CREATE TABLE IF NOT EXISTS specialist_slots (
      id                  BIGSERIAL PRIMARY KEY,
      specialist_node_id  TEXT NOT NULL,
      starts_at           TIMESTAMPTZ NOT NULL,
      ends_at             TIMESTAMPTZ NOT NULL,
      status              TEXT NOT NULL DEFAULT 'open',
      created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await p.query(
    `CREATE INDEX IF NOT EXISTS specialist_slots_idx ON specialist_slots(specialist_node_id, starts_at)`,
  );
  // One slot per specialist per start time — a double-published slot would
  // let two people book "the same" time.
  await p.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS specialist_slots_uniq ON specialist_slots(specialist_node_id, starts_at)`,
  );
  await p.query(`
    CREATE TABLE IF NOT EXISTS bookings (
      id          BIGSERIAL PRIMARY KEY,
      slot_id     BIGINT NOT NULL REFERENCES specialist_slots(id) ON DELETE CASCADE,
      user_id     TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'confirmed',
      note        TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await p.query(`CREATE INDEX IF NOT EXISTS bookings_user_idx ON bookings(user_id, created_at DESC)`);
  await p.query(`CREATE UNIQUE INDEX IF NOT EXISTS bookings_slot_uniq ON bookings(slot_id) WHERE status = 'confirmed'`);

  // Recurring weekly availability. Publishing every slot by hand is why almost
  // nobody had any: an expert states a PATTERN once ("Tue & Thu 18:00–20:00,
  // 30-minute sessions") and concrete slots are generated forward from it.
  await p.query(`
    CREATE TABLE IF NOT EXISTS specialist_availability (
      id                  BIGSERIAL PRIMARY KEY,
      specialist_node_id  TEXT NOT NULL,
      weekday             SMALLINT NOT NULL,
      start_minute        SMALLINT NOT NULL,
      end_minute          SMALLINT NOT NULL,
      session_minutes     SMALLINT NOT NULL DEFAULT 30,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await p.query(
    `CREATE INDEX IF NOT EXISTS specialist_availability_idx ON specialist_availability(specialist_node_id, weekday)`,
  );
  // Generated slots are marked so re-materialising can clean up a rule that was
  // removed WITHOUT ever touching a hand-published or already-booked slot.
  await p.query(`ALTER TABLE specialist_slots ADD COLUMN IF NOT EXISTS from_rule BIGINT`);
  pool = p;
  console.log("graph-service: booking ready (postgres)");
}

/* -------------------- recurring weekly availability ------------------- */

export interface AvailabilityRule {
  id?: string;
  /** 0 = Sunday … 6 = Saturday (JS getUTCDay). */
  weekday: number;
  /** Minutes past midnight UTC. */
  startMinute: number;
  endMinute: number;
  sessionMinutes: number;
}

/** How far ahead a weekly pattern is turned into bookable slots. */
export const MATERIALIZE_WEEKS = 4;

const clampInt = (v: unknown, lo: number, hi: number, dflt: number): number => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;
};

/** Strict, NOT clamped: clamping an out-of-range weekday silently publishes
 *  sessions on the wrong day, which is worse than dropping the rule. */
const validWeekday = (v: unknown): number | null => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 && n <= 6 ? n : null;
};

export async function listAvailability(specialistNodeId: string): Promise<AvailabilityRule[]> {
  if (!pool) return [];
  const r = await pool.query(
    `SELECT id, weekday, start_minute, end_minute, session_minutes
       FROM specialist_availability WHERE specialist_node_id = $1
      ORDER BY weekday, start_minute`,
    [specialistNodeId],
  );
  return r.rows.map((row) => ({
    id: String(row.id),
    weekday: Number(row.weekday),
    startMinute: Number(row.start_minute),
    endMinute: Number(row.end_minute),
    sessionMinutes: Number(row.session_minutes),
  }));
}

/**
 * Replace a specialist's weekly pattern, then regenerate their forward slots.
 *
 * Replace-whole-set (rather than per-rule edits) keeps the UI a single Save and
 * makes the generated slots a pure function of the rules.
 */
export async function setAvailability(
  specialistNodeId: string,
  rules: unknown[],
): Promise<{ ok: true; rules: AvailabilityRule[]; created: number } | { ok: false; error: string }> {
  if (!pool) return { ok: false, error: "booking disabled" };
  const clean: AvailabilityRule[] = [];
  for (const raw of (rules ?? []).slice(0, 40)) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const weekday = validWeekday(r.weekday);
    if (weekday === null) continue;
    const startMinute = clampInt(r.startMinute, 0, 24 * 60 - 1, -1);
    const endMinute = clampInt(r.endMinute, 0, 24 * 60, -1);
    const sessionMinutes = clampInt(r.sessionMinutes, 10, 240, 30);
    // A window shorter than one session produces nothing — reject it here so
    // the expert is told, rather than silently saving a rule that never fires.
    if (startMinute < 0 || endMinute < 0 || endMinute - startMinute < sessionMinutes) continue;
    clean.push({ weekday, startMinute, endMinute, sessionMinutes });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM specialist_availability WHERE specialist_node_id = $1`, [specialistNodeId]);
    for (const r of clean) {
      await client.query(
        `INSERT INTO specialist_availability (specialist_node_id, weekday, start_minute, end_minute, session_minutes)
         VALUES ($1, $2, $3, $4, $5)`,
        [specialistNodeId, r.weekday, r.startMinute, r.endMinute, r.sessionMinutes],
      );
    }
    // Drop future generated-but-unbooked slots; the regeneration below rebuilds
    // whatever the new rules still imply. Hand-published slots (from_rule NULL)
    // and anything booked are never touched.
    await client.query(
      `DELETE FROM specialist_slots
        WHERE specialist_node_id = $1 AND from_rule IS NOT NULL
          AND status = 'open' AND starts_at > now()`,
      [specialistNodeId],
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }

  const created = await materializeSlots(specialistNodeId);
  return { ok: true, rules: await listAvailability(specialistNodeId), created };
}

/**
 * Turn the weekly pattern into concrete open slots for the next
 * {@link MATERIALIZE_WEEKS} weeks.
 *
 * Idempotent: the `(specialist_node_id, starts_at)` unique index means a
 * re-run inserts only what's missing, so this is safe to call on every read.
 * Times are UTC — the client renders in the viewer's zone.
 */
export async function materializeSlots(specialistNodeId: string): Promise<number> {
  if (!pool) return 0;
  const rules = await listAvailability(specialistNodeId);
  if (rules.length === 0) return 0;

  const now = Date.now();
  const horizon = now + MATERIALIZE_WEEKS * 7 * 24 * 60 * 60 * 1000;
  const rows: { start: Date; end: Date; ruleId: string }[] = [];

  // Walk each day in the window once and emit that day's sessions.
  const day = new Date();
  day.setUTCHours(0, 0, 0, 0);
  for (; day.getTime() <= horizon; day.setUTCDate(day.getUTCDate() + 1)) {
    for (const rule of rules) {
      if (rule.weekday !== day.getUTCDay()) continue;
      for (let m = rule.startMinute; m + rule.sessionMinutes <= rule.endMinute; m += rule.sessionMinutes) {
        const start = new Date(day.getTime() + m * 60_000);
        if (start.getTime() <= now || start.getTime() > horizon) continue;
        rows.push({
          start,
          end: new Date(start.getTime() + rule.sessionMinutes * 60_000),
          ruleId: rule.id!,
        });
      }
    }
  }
  if (rows.length === 0) return 0;

  const r = await pool.query(
    `INSERT INTO specialist_slots (specialist_node_id, starts_at, ends_at, from_rule)
     SELECT $1, s.starts_at, s.ends_at, s.from_rule
       FROM unnest($2::timestamptz[], $3::timestamptz[], $4::bigint[])
            AS s(starts_at, ends_at, from_rule)
     ON CONFLICT (specialist_node_id, starts_at) DO NOTHING`,
    [
      specialistNodeId,
      rows.map((x) => x.start.toISOString()),
      rows.map((x) => x.end.toISOString()),
      rows.map((x) => Number(x.ruleId)),
    ],
  );
  return r.rowCount ?? 0;
}

const slotRow = (row: Record<string, unknown>): Slot => ({
  id: String(row.id),
  specialistNodeId: String(row.specialist_node_id),
  startsAt: new Date(row.starts_at as string).toISOString(),
  endsAt: new Date(row.ends_at as string).toISOString(),
  status: row.status as SlotStatus,
  ...(row.booked_by ? { bookedBy: String(row.booked_by) } : {}),
  ...(row.note ? { note: String(row.note) } : {}),
});

/** Upcoming slots for a specialist. Past slots are never shown — a calendar
 *  full of last month is worse than an empty one. */
export async function listSlots(
  specialistNodeId: string,
  opts: { includeBooked?: boolean } = {},
): Promise<Slot[]> {
  if (!pool) return [];
  const r = await pool.query(
    `SELECT s.*, b.user_id AS booked_by
       FROM specialist_slots s
       LEFT JOIN bookings b ON b.slot_id = s.id AND b.status = 'confirmed'
      WHERE s.specialist_node_id = $1
        AND s.starts_at > now()
        AND s.status <> 'cancelled'
        AND ($2::boolean OR s.status = 'open')
      ORDER BY s.starts_at`,
    [specialistNodeId, !!opts.includeBooked],
  );
  return r.rows.map(slotRow);
}

export async function publishSlot(
  specialistNodeId: string,
  startsAt: string,
  endsAt: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!pool) return { ok: false, error: "booking disabled" };
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return { ok: false, error: "invalid times" };
  if (end <= start) return { ok: false, error: "end must be after start" };
  if (start.getTime() < Date.now()) return { ok: false, error: "cannot publish a slot in the past" };
  try {
    const r = await pool.query(
      `INSERT INTO specialist_slots (specialist_node_id, starts_at, ends_at) VALUES ($1, $2, $3)
       ON CONFLICT (specialist_node_id, starts_at) DO NOTHING RETURNING id`,
      [specialistNodeId, start.toISOString(), end.toISOString()],
    );
    if (!r.rowCount) return { ok: false, error: "you already have a slot at that time" };
    return { ok: true, id: String(r.rows[0].id) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "could not publish" };
  }
}

/** Withdraw an unbooked slot. A booked one must be cancelled instead, so the
 *  person who booked always learns about it. */
export async function withdrawSlot(
  slotId: string,
  specialistNodeId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!pool) return { ok: false, error: "booking disabled" };
  const r = await pool.query(
    `DELETE FROM specialist_slots
      WHERE id = $1 AND specialist_node_id = $2 AND status = 'open' RETURNING id`,
    [slotId, specialistNodeId],
  );
  if (!r.rowCount) return { ok: false, error: "slot not found, or already booked" };
  return { ok: true };
}

/**
 * Book a slot. The `FOR UPDATE` lock + the status re-check inside the
 * transaction is what makes double-booking impossible under concurrency —
 * two people tapping the same slot at once can't both win.
 */
export async function bookSlot(
  slotId: string,
  userId: string,
  note?: string,
): Promise<{ ok: true; slot: Slot } | { ok: false; error: string }> {
  if (!pool) return { ok: false, error: "booking disabled" };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query(`SELECT * FROM specialist_slots WHERE id = $1 FOR UPDATE`, [slotId]);
    if (!r.rowCount) {
      await client.query("ROLLBACK");
      return { ok: false, error: "slot not found" };
    }
    const slot = r.rows[0];
    if (slot.status !== "open") {
      await client.query("ROLLBACK");
      return { ok: false, error: "that slot was just taken" };
    }
    if (new Date(slot.starts_at).getTime() < Date.now()) {
      await client.query("ROLLBACK");
      return { ok: false, error: "that slot is in the past" };
    }
    await client.query(`INSERT INTO bookings (slot_id, user_id, note) VALUES ($1, $2, $3)`, [
      slotId,
      userId,
      note ?? null,
    ]);
    await client.query(`UPDATE specialist_slots SET status = 'booked' WHERE id = $1`, [slotId]);
    await client.query("COMMIT");
    return { ok: true, slot: slotRow({ ...slot, status: "booked", booked_by: userId }) };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/** Cancel a booking — either side. The slot reopens. */
export async function cancelBooking(
  slotId: string,
  actorId: string,
  specialistNodeId: string,
): Promise<{ ok: true; bookedBy: string } | { ok: false; error: string }> {
  if (!pool) return { ok: false, error: "booking disabled" };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query(
      `SELECT b.user_id, s.specialist_node_id
         FROM bookings b JOIN specialist_slots s ON s.id = b.slot_id
        WHERE b.slot_id = $1 AND b.status = 'confirmed' FOR UPDATE`,
      [slotId],
    );
    if (!r.rowCount) {
      await client.query("ROLLBACK");
      return { ok: false, error: "no confirmed booking for that slot" };
    }
    const bookedBy = String(r.rows[0].user_id);
    // Only the person who booked, or the specialist whose slot it is.
    if (actorId !== bookedBy && specialistNodeId !== String(r.rows[0].specialist_node_id)) {
      await client.query("ROLLBACK");
      return { ok: false, error: "not your booking" };
    }
    await client.query(`UPDATE bookings SET status = 'cancelled' WHERE slot_id = $1 AND status = 'confirmed'`, [slotId]);
    await client.query(`UPDATE specialist_slots SET status = 'open' WHERE id = $1`, [slotId]);
    await client.query("COMMIT");
    return { ok: true, bookedBy };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export interface BookingRow {
  slotId: string;
  specialistNodeId: string;
  startsAt: string;
  endsAt: string;
  status: string;
  note?: string;
}

/** A user's upcoming confirmed bookings. */
export async function myBookings(userId: string): Promise<BookingRow[]> {
  if (!pool) return [];
  const r = await pool.query(
    `SELECT b.slot_id, b.status, b.note, s.specialist_node_id, s.starts_at, s.ends_at
       FROM bookings b JOIN specialist_slots s ON s.id = b.slot_id
      WHERE b.user_id = $1 AND b.status = 'confirmed' AND s.starts_at > now()
      ORDER BY s.starts_at`,
    [userId],
  );
  return r.rows.map((row) => ({
    slotId: String(row.slot_id),
    specialistNodeId: String(row.specialist_node_id),
    startsAt: new Date(row.starts_at).toISOString(),
    endsAt: new Date(row.ends_at).toISOString(),
    status: String(row.status),
    ...(row.note ? { note: String(row.note) } : {}),
  }));
}
