/**
 * connector-youtube — publishes ingested YouTube content onto NATS.
 *
 * Every connector speaks the same two subjects (see @constellation/graph-core):
 *   graph.node.upsert  ·  graph.edge.upsert
 *
 * graph-service subscribes and merges events into the live graph + Neo4j.
 * This stub publishes a demo video and a WATCHES edge from "me" — replace
 * with YouTube Data API + OAuth when ready.
 */
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { connect, JSONCodec } from "nats";
import { NATS_SUBJECTS, type EdgeUpsertEvent, type NodeUpsertEvent } from "@constellation/graph-core";

try {
  const here = dirname(fileURLToPath(import.meta.url));
  (process as NodeJS.Process & { loadEnvFile?: (p: string) => void }).loadEnvFile?.(
    resolve(here, "../../../../.env"),
  );
} catch {
  /* no repo-root .env */
}

const NATS_URL = process.env.NATS_URL ?? "nats://localhost:4222";
const INTERVAL_MS = Number(process.env.CONNECTOR_INTERVAL_MS ?? 0); // 0 = publish once

const demoNode: NodeUpsertEvent = {
  id: "v_dQw4w9WgXcQ",
  type: "video",
  label: "But what is a neural network?",
  sub: "YouTube · 3Blue1Brown",
  clusters: ["tech_ai"],
  source: "youtube",
  externalId: "dQw4w9WgXcQ",
};

const demoEdge: EdgeUpsertEvent = {
  source: "me",
  target: demoNode.id,
  type: "WATCHES",
  weight: 1,
  provenance: "youtube",
};

async function publish(nc: Awaited<ReturnType<typeof connect>>) {
  const jc = JSONCodec();
  nc.publish(NATS_SUBJECTS.NODE_UPSERT, jc.encode(demoNode));
  nc.publish(NATS_SUBJECTS.EDGE_UPSERT, jc.encode(demoEdge));
  console.log("connector-youtube: published demo node + edge to NATS");
}

async function main() {
  const nc = await connect({ servers: NATS_URL });
  console.log(`connector-youtube connected to ${NATS_URL}`);

  if (INTERVAL_MS > 0) {
    await publish(nc);
    setInterval(() => publish(nc).catch(console.error), INTERVAL_MS);
  } else {
    await publish(nc);
    await nc.drain();
    console.log("connector-youtube: done (one-shot). Set CONNECTOR_INTERVAL_MS to repeat.");
  }
}

main().catch((e) => {
  console.error("connector-youtube failed:", e);
  process.exit(1);
});
