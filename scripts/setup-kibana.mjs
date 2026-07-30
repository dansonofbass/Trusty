#!/usr/bin/env node
/**
 * One-shot Kibana provisioning: waits for ES + Kibana, PUTs the index
 * template (idempotent — same one graph-service creates lazily), creates the
 * `trusty-events-*` data view, and seeds one marker event so the view isn't
 * empty on first open. Run next to the stack:
 *
 *   docker compose exec -T graph-service node /workspace/scripts/setup-kibana.mjs
 *   # or: ES_URL=http://localhost:9200 KIBANA_URL=http://localhost:5601 node scripts/setup-kibana.mjs
 */
const ES = (process.env.ES_URL ?? "http://elasticsearch:9200").replace(/\/+$/, "");
const KB = (process.env.KIBANA_URL ?? "http://kibana:5601").replace(/\/+$/, "");

async function waitFor(name, probe, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      if (await probe()) {
        console.log(`${name} ready`);
        return;
      }
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error(`${name} not reachable`);
}

await waitFor("elasticsearch", async () => (await fetch(`${ES}/_cluster/health`)).ok);
await waitFor("kibana", async () => (await fetch(`${KB}/api/status`)).ok);

// Index template (matches domainEventBus.ts).
await fetch(`${ES}/_index_template/trusty-events`, {
  method: "PUT",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
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
  }),
});
console.log("index template ✓");

// Marker doc so the data view has a mapping to discover.
const day = new Date().toISOString().slice(0, 10).replace(/-/g, ".");
await fetch(`${ES}/trusty-events-${day}/_doc`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ ts: new Date().toISOString(), type: "user.provisioned", source: "graph-service", payload: { marker: true } }),
});

// Data view (idempotent: 409 = already there).
const dv = await fetch(`${KB}/api/data_views/data_view`, {
  method: "POST",
  headers: { "content-type": "application/json", "kbn-xsrf": "true" },
  body: JSON.stringify({ data_view: { title: "trusty-events-*", name: "Trusty events", timeFieldName: "ts" }, override: false }),
});
console.log(`data view ${dv.ok ? "✓" : `— ${dv.status} (likely exists)`}`);
console.log("Kibana ready → Discover: pick 'Trusty events'. Build dashboards from Lens: type breakdown, unique userId, app filter.");
