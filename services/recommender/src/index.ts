/**
 * recommender — turns graph structure + user signals into explainable suggestions.
 *
 * v2 (blend-v1): the pure friend-overlap engine from @constellation/graph-core,
 * re-ranked by per-user signals read from Postgres (search + interaction history,
 * community, feedback). Every recommendation still carries its structural
 * because-path — the blend changes ranking, not provenance. graph-service
 * delegates here on its read path when RECOMMENDER_URL is set, and falls back to
 * inline structural scoring if this service is unreachable.
 *
 * Later tiers (not yet built): BGE-M3 concept-embedding ANN (`concept_embeddings`
 * + pgvector `<=>`), personalized PageRank, NATS online re-ranking.
 */
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import express from "express";
import cors from "cors";
import pg from "pg";
import { buildDataset, computeRecommendations, type SignalMaps } from "@constellation/graph-core";
import { buildSignalMaps } from "./affinity";

try {
  const here = dirname(fileURLToPath(import.meta.url));
  (process as NodeJS.Process & { loadEnvFile?: (p: string) => void }).loadEnvFile?.(
    resolve(here, "../../../.env"),
  );
} catch {
  /* no repo-root .env */
}

const PORT = Number(process.env.PORT ?? 4002);
const DATABASE_URL = process.env.DATABASE_URL?.trim();
const pool = DATABASE_URL ? new pg.Pool({ connectionString: DATABASE_URL, max: 4 }) : null;

const app = express();
app.use(cors());
app.use(express.json({ limit: "8mb" }));

// Cheap liveness — the container healthcheck hits this every 10s, so it must NOT
// touch Postgres (a per-check DB query wastes a connection and can time out under
// pool pressure, flapping the container to unhealthy). DB reachability surfaces
// naturally on /recompute + its logs.
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "recommender",
    engine: pool ? "blend-v1" : "friend-overlap-v1",
    postgres: pool ? "configured" : "disabled",
  });
});

/**
 * Recompute recommendations for a user.
 * Body: { nodes, links, dismissed, communityByNode } — the viewer-narrowed slice
 * (never the raw union). With no nodes/links it scores the deterministic seed
 * world (structural only). Personalization signals are read from Postgres.
 */
app.post("/recompute/:id", async (req, res) => {
  const t0 = performance.now();
  const { nodes, links, dismissed, communityByNode } = req.body ?? {};
  const world =
    Array.isArray(nodes) && Array.isArray(links) ? { nodes, links } : buildDataset(2026);

  let signals: SignalMaps | undefined;
  if (pool && Array.isArray(nodes)) {
    try {
      signals = await buildSignalMaps(pool, req.params.id, world.nodes, communityByNode ?? {});
    } catch (e) {
      console.warn("recommender: signal build failed:", e instanceof Error ? e.message : e);
    }
  }

  const recommendations = computeRecommendations(world.nodes, world.links, req.params.id, {
    dismissed,
    signals,
  });
  res.json({ took_ms: Math.round(performance.now() - t0), recommendations, blended: !!signals });
});

app.listen(PORT, () =>
  console.log(`recommender listening on :${PORT}` + (pool ? " (blend-v1, postgres)" : "")),
);
