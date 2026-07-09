-- Trusty — Postgres bootstrap (pgvector ready for Phase 3 embeddings).
CREATE EXTENSION IF NOT EXISTS vector;

-- Placeholder for BGE-M3 concept embeddings (content-embedding rec tier).
-- Dim 1024 matches BGE-M3 + the live topic_embeddings (EMBEDDINGS_DIM default).
CREATE TABLE IF NOT EXISTS concept_embeddings (
  node_id TEXT PRIMARY KEY,
  embedding vector(1024),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS concept_embeddings_hnsw
  ON concept_embeddings USING hnsw (embedding vector_cosine_ops);

-- ── Writings (durable, logged record of what users wrote) ───────────
-- Neo4j keeps the graph nodes; Postgres is the source of truth for the full
-- writing content + an append-only event log (edits, weaves, and — later —
-- chat turns for the assistant). graph-service also CREATEs these on boot so
-- existing databases get them without a re-init.
CREATE TABLE IF NOT EXISTS writings (
  id          TEXT PRIMARY KEY,              -- = the thought node id once woven
  user_id     TEXT NOT NULL,
  title       TEXT,
  body        TEXT NOT NULL,
  extraction  JSONB,                         -- accepted entities + relations
  status      TEXT NOT NULL DEFAULT 'woven', -- draft | woven
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS writings_user_idx ON writings(user_id, updated_at DESC);

-- Append-only log: extracted | edited | woven | message (chat) …
CREATE TABLE IF NOT EXISTS writing_events (
  id          BIGSERIAL PRIMARY KEY,
  writing_id  TEXT NOT NULL REFERENCES writings(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL,
  kind        TEXT NOT NULL,
  detail      JSONB,
  at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS writing_events_idx ON writing_events(writing_id, at);

-- ── Trust outcomes (append-only feedback on trust recommendations) ──
-- The Neo4j TRUSTS edge keeps a rolling `outcome` cache; this table is the
-- authoritative history. graph-service also CREATEs it on boot (trustLog.ts).
CREATE TABLE IF NOT EXISTS trust_outcomes (
  id          BIGSERIAL PRIMARY KEY,
  edge_id     TEXT NOT NULL,
  from_id     TEXT NOT NULL,
  to_id       TEXT,
  user_id     TEXT NOT NULL,
  rec_node_id TEXT,
  kind        TEXT NOT NULL,                -- positive | negative | …
  value       REAL,                         -- normalized signal [-1,1]
  scope       JSONB,
  detail      JSONB,
  at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trust_outcomes_edge_idx ON trust_outcomes(edge_id, at);
CREATE INDEX IF NOT EXISTS trust_outcomes_pair_idx ON trust_outcomes(from_id, to_id);

-- ── Recommendation signals (search + interaction history) ───────────
-- Raw material for the per-user topic-affinity profile the blended recommender
-- reads. graph-service also CREATEs these on boot (searchLog.ts / interactionLog.ts).
CREATE TABLE IF NOT EXISTS search_events (
  id           BIGSERIAL PRIMARY KEY,
  user_id      TEXT NOT NULL,
  raw_query    TEXT,
  topic        TEXT,
  geo          TEXT,
  context      TEXT,
  expanded     JSONB,
  result_count INT NOT NULL DEFAULT 0,
  source       TEXT NOT NULL,                 -- trust-search | resolve-scope
  at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS search_events_user_idx  ON search_events(user_id, at DESC);
CREATE INDEX IF NOT EXISTS search_events_topic_idx ON search_events(topic, at DESC);

CREATE TABLE IF NOT EXISTS interaction_events (
  id         BIGSERIAL PRIMARY KEY,
  user_id    TEXT NOT NULL,
  node_id    TEXT NOT NULL,
  kind       TEXT NOT NULL,                   -- impression|click|accept|dismiss|befriend|add_to_sky|trust
  weight     REAL NOT NULL DEFAULT 1,
  topic      TEXT,
  community  INT,
  detail     JSONB,
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS interaction_events_user_idx ON interaction_events(user_id, at DESC);
CREATE INDEX IF NOT EXISTS interaction_events_node_idx ON interaction_events(user_id, node_id);

-- ── Recommendation cache (recompute-on-write) ───────────────────────
CREATE TABLE IF NOT EXISTS user_recommendations (
  user_id      TEXT PRIMARY KEY,
  recs         JSONB NOT NULL,
  graph_version BIGINT NOT NULL DEFAULT 0,
  computed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
