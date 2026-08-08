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
  pool = p;
  console.log("graph-service: booking ready (postgres)");
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
