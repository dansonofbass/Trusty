/**
 * NATS ingestion consumer — listens for connector events and upserts into the graph.
 */
import { connect, JSONCodec, type NatsConnection } from "nats";
import {
  NATS_SUBJECTS,
  upsertEdge,
  upsertNode,
  type Dataset,
  type EdgeUpsertEvent,
  type NodeUpsertEvent,
  type PlaceLinkResolvedEvent,
} from "@constellation/graph-core";

export interface NatsIngestOptions {
  url: string;
  getDataset: () => Dataset;
  /** Serialized write path — same queue REST mutations use. */
  commit: (next: Dataset) => Promise<Dataset>;
  /** Called when the places connector reports a resolved/failed link. */
  onLinkResolved?: (ev: PlaceLinkResolvedEvent) => Promise<void> | void;
}

export async function startNatsIngest(opts: NatsIngestOptions): Promise<NatsConnection> {
  const nc = await connect({ servers: opts.url });
  const jc = JSONCodec();

  const handle = async (kind: "node" | "edge", data: unknown) => {
    try {
      if (kind === "node") {
        const ev = data as NodeUpsertEvent;
        await opts.commit(upsertNode(opts.getDataset(), ev));
        console.log(`nats: upserted node ${ev.id} (${ev.type})`);
      } else {
        const ev = data as EdgeUpsertEvent;
        await opts.commit(upsertEdge(opts.getDataset(), ev));
        console.log(`nats: upserted edge ${ev.source} -[${ev.type}]-> ${ev.target}`);
      }
    } catch (e) {
      console.error(`nats: ${kind} upsert failed:`, e instanceof Error ? e.message : e);
    }
  };

  const subNode = nc.subscribe(NATS_SUBJECTS.NODE_UPSERT);
  const subEdge = nc.subscribe(NATS_SUBJECTS.EDGE_UPSERT);

  (async () => {
    for await (const msg of subNode) {
      await handle("node", jc.decode(msg.data));
    }
  })().catch((e) => console.error("nats node subscription ended:", e));

  (async () => {
    for await (const msg of subEdge) {
      await handle("edge", jc.decode(msg.data));
    }
  })().catch((e) => console.error("nats edge subscription ended:", e));

  if (opts.onLinkResolved) {
    const subLink = nc.subscribe(NATS_SUBJECTS.PLACE_LINK_RESOLVED);
    (async () => {
      for await (const msg of subLink) {
        try {
          await opts.onLinkResolved!(jc.decode(msg.data) as PlaceLinkResolvedEvent);
        } catch (e) {
          console.error("nats: link-resolved handler failed:", e instanceof Error ? e.message : e);
        }
      }
    })().catch((e) => console.error("nats link subscription ended:", e));
  }

  console.log(
    `graph-service: NATS ingest on ${opts.url} — ${NATS_SUBJECTS.NODE_UPSERT}, ${NATS_SUBJECTS.EDGE_UPSERT}`,
  );
  return nc;
}
