#!/usr/bin/env node
/**
 * One-shot Kibana provisioning: waits for ES + Kibana, PUTs the index
 * template (idempotent — same one graph-service creates lazily), ensures the
 * `trusty-events-*` data view, seeds a marker event, and imports the
 * "Trusty — Activity & Health" dashboard (8 visualizations, agg-based so the
 * saved-object JSON stays stable across Kibana 8.x). Re-running overwrites
 * the dashboard cleanly. Run next to the stack:
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

// Index template (matches domainEventBus.ts — keep in sync).
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
          metrics: { type: "object", dynamic: true },
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

// Data view: reuse an existing one (any id) or create with a known id.
let dvId = null;
try {
  const list = await (await fetch(`${KB}/api/data_views`, { headers: { "kbn-xsrf": "true" } })).json();
  dvId = (list.data_view ?? list.data_views ?? []).find((d) => d.title === "trusty-events-*")?.id ?? null;
} catch { /* fall through to create */ }
if (!dvId) {
  const dv = await fetch(`${KB}/api/data_views/data_view`, {
    method: "POST",
    headers: { "content-type": "application/json", "kbn-xsrf": "true" },
    body: JSON.stringify({
      data_view: { id: "trusty-events-dv", title: "trusty-events-*", name: "Trusty events", timeFieldName: "ts" },
      override: false,
    }),
  });
  dvId = "trusty-events-dv";
  console.log(`data view created ${dv.ok ? "✓" : `— ${dv.status}`}`);
} else {
  console.log(`data view found ✓ (${dvId})`);
}

/* ------------------------- dashboard objects ------------------------- */

const AXES = {
  grid: { categoryLines: false },
  categoryAxes: [{ id: "CategoryAxis-1", type: "category", position: "bottom", show: true, scale: { type: "linear" }, labels: { show: true, truncate: 100 }, title: {} }],
  valueAxes: [{ id: "ValueAxis-1", name: "LeftAxis-1", type: "value", position: "left", show: true, scale: { type: "linear", mode: "normal" }, labels: { show: true, rotate: 0, filter: false, truncate: 100 }, title: { text: "" } }],
  addTooltip: true, addLegend: true, legendPosition: "right", times: [], addTimeMarker: false,
  labels: { show: false }, thresholdLine: { show: false, value: 10, width: 1, style: "full", color: "#E7664C" },
};
const seriesParams = (type) => [{ show: true, type, mode: type === "histogram" ? "stacked" : "normal", data: { label: "Count", id: "1" }, valueAxis: "ValueAxis-1", drawLinesBetweenPoints: true, lineWidth: 2, showCircles: true, interpolate: "linear" }];
const dateHist = (id, schema = "segment") => ({ id, enabled: true, type: "date_histogram", schema, params: { field: "ts", useNormalizedEsInterval: true, interval: "auto", drop_partials: false, min_doc_count: 1, extended_bounds: {} } });
const count = { id: "1", enabled: true, type: "count", schema: "metric", params: {} };
const terms = (id, field, size, schema = "group") => ({ id, enabled: true, type: "terms", schema, params: { field, orderBy: "1", order: "desc", size, otherBucket: true, otherBucketLabel: "Other", missingBucket: false, missingBucketLabel: "Missing" } });

const mkVis = (id, title, visState, query = "") => ({
  id,
  type: "visualization",
  attributes: {
    title,
    visState: JSON.stringify(visState),
    uiStateJSON: "{}",
    kibanaSavedObjectMeta: {
      searchSourceJSON: JSON.stringify({ query: { query, language: "kuery" }, filter: [], indexRefName: "kibanaSavedObjectMeta.searchSourceJSON.index" }),
    },
  },
  references: [{ name: "kibanaSavedObjectMeta.searchSourceJSON.index", type: "index-pattern", id: dvId }],
});

const visualizations = [
  mkVis("tv-events-over-time", "Events over time (by type)", {
    title: "Events over time (by type)", type: "histogram",
    aggs: [count, dateHist("2"), terms("3", "type", 8)],
    params: { type: "histogram", ...AXES, seriesParams: seriesParams("histogram") },
  }),
  mkVis("tv-type-donut", "Event mix", {
    title: "Event mix", type: "pie",
    aggs: [count, terms("2", "type", 15, "segment")],
    params: { type: "pie", addTooltip: true, addLegend: true, legendPosition: "right", isDonut: true, labels: { show: false, values: true, last_level: true, truncate: 100 } },
  }),
  mkVis("tv-active-users", "Active users", {
    title: "Active users", type: "line",
    aggs: [{ id: "1", enabled: true, type: "cardinality", schema: "metric", params: { field: "userId" } }, dateHist("2")],
    params: { type: "line", ...AXES, seriesParams: seriesParams("line") },
  }),
  mkVis("tv-top-actors", "Most active users", {
    title: "Most active users", type: "table",
    aggs: [count, terms("2", "userId", 15, "bucket")],
    params: { perPage: 10, showPartialRows: false, showMetricsAtAllLevels: false, sort: { columnIndex: null, direction: null }, showTotal: false, totalFunc: "sum", percentageCol: "" },
  }),
  mkVis("tv-summit-engagement", "Summit engagement", {
    title: "Summit engagement", type: "histogram",
    aggs: [count, dateHist("2"), terms("3", "type", 8)],
    params: { type: "histogram", ...AXES, seriesParams: seriesParams("histogram") },
  }, "type: squad.* or type: meeting.* or type: session.* or type: summit.* or type: note.*"),
  mkVis("tv-agent-activity", "Agent activity", {
    title: "Agent activity", type: "histogram",
    aggs: [count, dateHist("2"), terms("3", "type", 5)],
    params: { type: "histogram", ...AXES, seriesParams: seriesParams("histogram") },
  }, "type: agent.*"),
  mkVis("tv-messages", "Chat messages", {
    title: "Chat messages", type: "histogram",
    aggs: [count, dateHist("2")],
    params: { type: "histogram", ...AXES, seriesParams: seriesParams("histogram") },
  }, "type: room.message_sent"),
  mkVis("tv-graph-gauges", "Platform gauges (users · edges · messages)", {
    title: "Platform gauges (users · edges · messages)", type: "line",
    aggs: [
      { id: "1", enabled: true, type: "max", schema: "metric", params: { field: "metrics.users", customLabel: "users" } },
      { id: "4", enabled: true, type: "max", schema: "metric", params: { field: "metrics.persons", customLabel: "persons" } },
      { id: "5", enabled: true, type: "max", schema: "metric", params: { field: "metrics.savedEdges", customLabel: "contact edges" } },
      { id: "6", enabled: true, type: "max", schema: "metric", params: { field: "metrics.messages24h", customLabel: "messages/24h" } },
      dateHist("2"),
    ],
    params: { type: "line", ...AXES, seriesParams: seriesParams("line") },
  }, "type: system.stats"),
];

// 48-unit grid; rows of two 24-wide panels, 12 high.
const panels = visualizations.map((v, i) => ({
  version: "8.15.0",
  type: "visualization",
  gridData: { x: (i % 2) * 24, y: Math.floor(i / 2) * 12, w: 24, h: 12, i: String(i + 1) },
  panelIndex: String(i + 1),
  embeddableConfig: { enhancements: {} },
  panelRefName: `panel_${i + 1}`,
}));

const dashboard = {
  id: "tv-activity-health",
  type: "dashboard",
  attributes: {
    title: "Trusty — Activity & Health",
    description: "Domain events: activity, users, summit engagement, chat, agent usage, and system gauges.",
    hits: 0,
    panelsJSON: JSON.stringify(panels),
    optionsJSON: JSON.stringify({ useMargins: true, syncColors: false, hidePanelTitles: false }),
    version: 1,
    timeRestore: true,
    timeFrom: "now-7d",
    timeTo: "now",
    refreshInterval: { pause: false, value: 60000 },
    kibanaSavedObjectMeta: { searchSourceJSON: JSON.stringify({ query: { query: "", language: "kuery" }, filter: [] }) },
  },
  references: visualizations.map((v, i) => ({ name: `panel_${i + 1}`, type: "visualization", id: v.id })),
};

const ndjson = [...visualizations, dashboard].map((o) => JSON.stringify(o)).join("\n");
const form = new FormData();
form.append("file", new Blob([ndjson], { type: "application/ndjson" }), "trusty-dashboards.ndjson");
const imp = await fetch(`${KB}/api/saved_objects/_import?overwrite=true`, {
  method: "POST",
  headers: { "kbn-xsrf": "true" },
  body: form,
});
const impBody = await imp.json().catch(() => ({}));
console.log(`dashboard import ${imp.ok && impBody.success !== false ? "✓" : `— ${imp.status} ${JSON.stringify(impBody).slice(0, 300)}`}`);
console.log("Open Kibana → Dashboards → “Trusty — Activity & Health” (auto-refreshes every 60s).");
