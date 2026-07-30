/**
 * Domain event bus — emitEvent() is fire-and-forget from request paths:
 * it MUST never throw and never add latency.
 *
 * Two sinks, both optional:
 * - NATS: `trusty.events.<type>` on the existing connection (future #50
 *   backbone consumers subscribe here; plain pub/sub for now).
 * - Elasticsearch: in-memory queue flushed via _bulk every 3s / 100 events
 *   into daily indices `trusty-events-YYYY.MM.DD` (Kibana reads these).
 *   No-op without ELASTICSEARCH_URL. An index template is PUT on init so
 *   the useful fields are keywords and `ts` is the time field.
 */
import { JSONCodec, type NatsConnection } from "nats";
import { type DomainEvent, type DomainEventType } from "@constellation/graph-core";

const ES_URL = process.env.ELASTICSEARCH_URL?.replace(/\/+$/, "");
const codec = JSONCodec();

let nats: NatsConnection | null = null;
let queue: DomainEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let templateReady = false;

/** Hand over the shared NATS connection once startNatsIngest has it. */
export function attachEventNats(nc: NatsConnection): void {
  nats = nc;
}

export function domainEventsEnabled(): boolean {
  return !!ES_URL || !!nats;
}

const INDEX_TEMPLATE = {
  index_patterns: ["trusty-events-*"],
  template: {
    settings: { number_of_shards: 1, number_of_replicas: 0 },
    mappings: {
      properties: {
        ts: { type: "date" },
        type: { type: "keyword" },
        userId: { type: "keyword" },
        app: { type: "keyword" },
        targetId: { type: "keyword" },
        targetType: { type: "keyword" },
        source: { type: "keyword" },
        payload: { type: "flattened" },
      },
    },
  },
};

async function ensureTemplate(): Promise<void> {
  if (templateReady || !ES_URL) return;
  try {
    const r = await fetch(`${ES_URL}/_index_template/trusty-events`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(INDEX_TEMPLATE),
    });
    templateReady = r.ok;
    if (r.ok) console.log("domain-events: ES index template ready");
  } catch {
    /* ES not up yet — retried on next flush */
  }
}

async function flush(): Promise<void> {
  flushTimer = null;
  if (!ES_URL || queue.length === 0) return;
  const batch = queue;
  queue = [];
  await ensureTemplate();
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, ".");
  const index = `trusty-events-${day}`;
  const body =
    batch.map((e) => `${JSON.stringify({ index: { _index: index, _id: e.id } })}\n${JSON.stringify(e)}`).join("\n") +
    "\n";
  try {
    const r = await fetch(`${ES_URL}/_bulk`, {
      method: "POST",
      headers: { "content-type": "application/x-ndjson" },
      body,
    });
    if (!r.ok) throw new Error(`bulk ${r.status}`);
  } catch (e) {
    // Put the batch back (bounded) — ES restarts must not lose everything.
    queue = [...batch.slice(-500), ...queue].slice(-1000);
    if (queue.length >= 1000) {
      console.warn("domain-events: ES unreachable, buffer full — dropping oldest");
    }
    void e;
  }
}

function scheduleFlush(): void {
  if (queue.length >= 100) {
    void flush();
    return;
  }
  if (!flushTimer) flushTimer = setTimeout(() => void flush(), 3000);
}

let seq = 0;
const newId = (): string => `ev_${Date.now().toString(36)}${(seq++ % 46656).toString(36)}`;

/** Emit a domain event. Safe anywhere — never throws, never blocks. */
export function emitEvent(
  type: DomainEventType,
  fields: Omit<Partial<DomainEvent>, "type" | "id" | "ts" | "source"> & { source?: DomainEvent["source"] } = {},
): void {
  try {
    const event: DomainEvent = {
      id: newId(),
      type,
      ts: new Date().toISOString(),
      source: fields.source ?? "graph-service",
      ...(fields.userId ? { userId: fields.userId } : {}),
      ...(fields.app ? { app: fields.app } : {}),
      ...(fields.targetId ? { targetId: fields.targetId } : {}),
      ...(fields.targetType ? { targetType: fields.targetType } : {}),
      ...(fields.payload ? { payload: fields.payload } : {}),
    };
    if (nats) {
      try {
        nats.publish(`trusty.events.${type}`, codec.encode(event));
      } catch {
        /* NATS down — ES sink still gets it */
      }
    }
    if (ES_URL) {
      queue.push(event);
      scheduleFlush();
    }
  } catch {
    /* absolutely never propagate */
  }
}

/** Ingest an already-validated envelope from the BFF / extractor. */
export function ingestEvent(event: DomainEvent): void {
  try {
    if (nats) {
      try {
        nats.publish(`trusty.events.${event.type}`, codec.encode(event));
      } catch { /* see above */ }
    }
    if (ES_URL) {
      queue.push(event);
      scheduleFlush();
    }
  } catch {
    /* never propagate */
  }
}
