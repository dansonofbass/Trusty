# ✦ Trusty

**Your social universe as a graph.** People, books, news, music, videos, social accounts, posts, movies, financial signals and places are all first-class nodes; friendships and tastes are edges. The recommendation engine doesn't hide behind a feed — its *interface is the graph itself*: suggestions appear as pulsing gold stars at the frontier of your constellation, each with a visible **because-path** showing exactly which friends connect you to it.

This is a frontend-heavy prototype of a new kind of social network, plus the skeleton of the microservice estate that will power it.

---

## Quickstart — the whole stack in Docker (recommended)

The app runs **API-only** through the **GraphQL gateway** — one command brings up
everything (web, gateway, graph-service, Neo4j, NATS, recommender, extractor,
Ollama):

```bash
docker compose up              # → http://localhost:3000
# or
npm run compose:up

# once, for real LLM extraction in the Write view:
docker compose exec ollama ollama pull gemma3
```

**Request path in Docker:**

```
browser (:3000) ──GraphQL──▶ gateway (:4000) ──REST──▶ graph-service (:4001) ──▶ Neo4j
              └──REST──────▶ extractor (:4003) ──▶ Ollama + graph-service
```

Services wait for healthchecks before the web container starts, so the gateway
is ready when you open the app. A shared `install` service runs `npm install`
once so parallel containers don't race on `node_modules`.

| Service | URL |
| --- | --- |
| web (Next.js) | http://localhost:3000 |
| graph-service (REST, internal) | http://localhost:4001 |
| gateway (GraphQL — **web uses this**) | http://localhost:4000/graphql |
| recommender | http://localhost:4002 |
| extractor | http://localhost:4003 |
| neo4j browser · ollama | http://localhost:7474 · http://localhost:11434 |

## Quickstart — locally with npm

```bash
npm install               # once, at the repo root (npm workspaces)
npm run dev:graph         # graph API (internal)        → :4001  (start this first)
npm run dev:gateway       # GraphQL edge (web uses this) → :4000/graphql
npm run dev:extractor     # thought-extractor             → :4003
npm run dev               # web app (API mode)            → :3000
```

The frontend talks to the **GraphQL gateway** on `:4000` for all graph reads and
mutations; the Write view still calls the **extractor** on `:4003`. Env lives in
`apps/web/.env.local` — Next reads env from `apps/web/`, **not** the repo root.

Optional extras:

```bash
npm run dev:gateway                      # GraphQL edge → :4000/graphql
npm run dev:recommender                  # recommendation service → :4002
docker compose up neo4j postgres nats    # Phase-2 infrastructure only
```

Production build: `npm run build && npm run start`.

> Want the old in-browser seed world (no backend)? Set
> `NEXT_PUBLIC_DATA_SOURCE=mock` in `apps/web/.env.local`, use `?source=mock`,
> or the bottom-left mode toggle.

For **real Claude extraction** in the Write view, give the extractor a key
(otherwise it uses a deterministic offline heuristic — see `.env.example`):

```bash
ANTHROPIC_API_KEY=sk-ant-... npm run dev:extractor
```

---

## The interface

| View | What it shows |
| --- | --- |
| **Universe** | Everything 1–2 hops from you. Click a star to inspect it; double-click to *enter* its neighborhood. |
| **Circles** | Louvain communities detected live from structure — friends cluster *with the interests they share*. Click a circle in the legend to isolate it. |
| **Discover** | The recommendation frontier. Gold pulsing rings are suggestions; selecting one lights up its because-path (`You → Sara → Radiohead`) with the human-readable reason and affinity score. |
| **Path** | Click any two nodes to reveal the shortest chain connecting them through your universe. |
| **Write** | Think out loud — paste an article or write a thought, and Claude extracts its entities and the relations between them, weaving them into your sky as concept nodes. |

Plus: type lens (hide/show any of the 10+ node types), `/` search that teleports
the camera, a node inspector with grouped connections and a "shared with you"
lens for friends, semantic zoom (labels and glyphs appear as you approach),
and full keyboard escape-hatches (`Esc` walks back focus → selection → path).

### The concentric cosmology

Distance from You encodes relationship distance. You sit at the origin; the
things you're **directly** connected to orbit close (your inner sky); the
**outer world** — friends-of-friends and the interests you don't yet share —
is pushed far out; and the **recommendation frontier** is its own gold ring
beyond. **Discover inverts the radii**: the frontier is pulled close while
your known sky drifts to the rim — the spatial posture of going out to find
something new. Faint dashed orbit-bands label the regions so the depth reads
at a glance; pan and zoom to travel between near and far.

## Acting in your sky (Phase 2 — live)

Every user action **is a graph mutation** — that's the product's whole
metaphor — and all of them work in both data modes:

| Action | Where | What happens in the graph |
| --- | --- | --- |
| **Befriend / Unfriend** | Inspector on any person | `FRIENDS_WITH` edge created / removed |
| **Add to my sky / Remove** | Inspector on any content | typed edge inferred (`READS`, `WATCHES`, `TRACKS`…) |
| **Post** | ✦ Post button, top bar | new `post` node + `POSTED` edge, spawns from You |
| **Accept a recommendation** | gold card in the Inspector | the dashed ghost edge **solidifies** into a real edge |
| **Dismiss** | gold card in the Inspector | excluded from the frontier forever |

After every action the **recommendation frontier recomputes live** — accept
something and it leaves the frontier; remove it later and it re-enters.
Nothing is canned: the same `computeRecommendations` engine in
`packages/graph-core` runs in the browser (mock mode) and inside
graph-service (api mode), so the two modes are behaviorally identical.

### Switching data modes at runtime

A chip at the bottom of the left rail shows the current source —
**MOCK DATA** (indigo) or **LIVE API** (green) — with a one-click switch
(persisted in `localStorage`; `?source=api|mock` in the URL also works, no
rebuild needed). In api mode every action is an HTTP write to graph-service,
which mutates its dataset with the *same* shared functions, **persists it to
Neo4j**, and returns the updated graph; the client merges by id so the force
layout never loses positions. `POST /api/reset` restores the seed world while
demoing.

### Durable storage (Neo4j)

`graph-service` persists the graph to **Neo4j** when `NEO4J_URI` is set (always,
in Docker). On first boot it seeds the deterministic world into Neo4j; after
that it loads from Neo4j, so **mutations survive restarts**. Browse the data at
http://localhost:7474 (`neo4j` / `constellation`).

### Wired services (what talks to what)

| Component | Wired to | Env |
| --- | --- | --- |
| **graph-service** | Neo4j (persist), NATS (ingest), recommender (frontier) | `NEO4J_URI`, `NATS_URL`, `RECOMMENDER_URL` |
| **recommender** | Postgres/pgvector (schema ready, embeddings Phase 3) | `DATABASE_URL` |
| **extractor** | Ollama → graph-service | `OLLAMA_HOST`, `GRAPH_SERVICE_URL` |
| **connector-youtube** | NATS → graph-service ingest | `NATS_URL` |
| **web** | gateway GraphQL + extractor REST | `NEXT_PUBLIC_GATEWAY_URL`, `NEXT_PUBLIC_EXTRACTOR_API` |

**NATS ingestion:** connectors publish `graph.node.upsert` / `graph.edge.upsert`
(see `packages/graph-core/src/events.ts`); graph-service subscribes and merges
into Neo4j. Try: `npm run dev:connector-youtube` while graph-service is running.

**Recommendations:** graph-service delegates frontier scoring to recommender when
`RECOMMENDER_URL` is set (same explainable contract; Phase 3 swaps the engine
inside recommender for pgvector + PageRank).

**Postgres:** `infra/postgres/init.sql` creates the `concept_embeddings` table
with pgvector. On a fresh volume (`docker compose down -v`), recommender `/health`
reports `concept_embeddings` in `pgTables`.

## Thoughts into graph (Claude-powered)

The **Write** view turns your own writing into part of the graph. You paste an
article or type a thought; the `extractor` service sends it to the **Claude
Messages API** with a strict extraction prompt, and Claude returns structured
JSON — the entities the piece is *about* and the relations between them. That
becomes graph structure:

```
   you ──REFLECTS_ON──▶ (thought) ──MENTIONS──▶ (concept: attention)
                            │                         │
                            │                    RELATES_TO ("is a kind of")
                            ▼                         ▼
                        MENTIONS ─────────▶ (concept: deep work)
```

- a **`thought`** node holds your prose (title + summary + the full text),
- each extracted entity becomes a **`concept`** node (or links to a `person` /
  `book` / `movie` you already have), joined by **`MENTIONS`**,
- the relations Claude finds become **`RELATES_TO`** edges carrying the
  relation phrase ("contradicts", "is evidence for", "enables").

**Threads emerge for free.** Concepts are de-duplicated by name, so when two
different thoughts both mention *reflexivity* or *حافظهٔ جمعی*, they attach to
the **same** concept node — and that shared idea becomes a thread linking the
pieces of writing. Over time your thinking turns into a navigable web, and
because concepts are first-class nodes, they flow straight into the
recommendation engine: write about a topic and related things surface on your
frontier.

The contract — `(text) → { entities, relations }` with the prompt, the JSON
shape, and the graph-folding logic — lives in
`packages/graph-core/src/extract.ts`, shared by the service and the in-browser
fallback.

### Extraction providers (Ollama → Claude → heuristic)

The `extractor` service picks the first available provider:

1. **LangExtract-style, on a local Ollama model** *(preferred — set `OLLAMA_HOST`).*
   Following [this GraphRAG architecture](https://medium.com/@manthapavankumar11/a-practical-graphrag-architecture-using-langextract-neo4j-qdrant-and-ollama-0e4c86908c41),
   a local LLM is given a `prompt_description` plus **grounded few-shot
   examples** and returns flat, *grouped* extractions; each group has an anchor
   entity and members whose `relation` attribute becomes the edge label.
   `convertExtractionsToGraph` (the TS port of the blog's
   `_convert_extractions_to_graph`) re-assembles them into nodes + edges. The
   prompt, examples, and conversion live in
   `packages/graph-core/src/langextract.ts`.
2. **Claude Messages API** — used when `ANTHROPIC_API_KEY` is set and Ollama is not.
3. **Deterministic heuristic** — offline fallback so the pipeline always works.

```bash
# 1) LangExtract-style local extraction (no API key, fully local)
docker compose up ollama                                 # or run Ollama natively
ollama pull gemma3                                        # one model, once
OLLAMA_HOST=http://localhost:11434 npm run dev:extractor  # :4003
NEXT_PUBLIC_DATA_SOURCE=api npm run dev                   # Write view → Ollama

# 2) or use Claude instead (leave OLLAMA_HOST unset)
ANTHROPIC_API_KEY=sk-ant-... npm run dev:extractor
```

> Want the *actual* Python `langextract` library + Neo4j/Qdrant exactly as in
> the blog? Run it as a sidecar and point the extractor at it — the
> `(text) → { entities, relations }` contract is the only thing the rest of
> Trusty depends on.

### Entity sources (Wikipedia)

After extraction, the `extractor` resolves each entity against **Wikipedia**
(`ENTITY_SOURCES=wikipedia`, default). Persian names search `fa.wikipedia.org`;
everything else uses `en.wikipedia.org`. Matches are stored on the entity as
`sources[]` and copied onto graph nodes when ingested — the inspector shows a
clickable Wikipedia link.

Disable with `ENTITY_SOURCES=none`. Implementation:
`packages/graph-core/src/sources.ts`.

## Monorepo layout

```
constellation/
├─ apps/
│  └─ web/                     # Next.js 16 · React 19 · Tailwind v4 · react-force-graph
│     └─ src/
│        ├─ components/        # GraphCanvas, Explorer shell, TopBar, LeftRail,
│        │                     # Inspector, HintBar, ThoughtComposer (the Write view)
│        └─ lib/               # palette (the taxonomy IS the palette), zustand store, dataSource
├─ packages/
│  └─ graph-core/              # shared TS source: taxonomy types, seeded world,
│                              # Louvain communities, shortest paths, explainable recs,
│                              # mutations (the action vocabulary), Claude extraction contract
├─ services/
│  ├─ graph-service/           # owns the graph · REST · durable in Neo4j (store.ts)
│  ├─ gateway/                 # GraphQL Yoga edge composing internal services
│  ├─ recommender/             # explainable recs · pgvector + BGE-M3 + PPR in Phase 3
│  ├─ extractor/               # Claude Messages API — articles/thoughts → entities + relations
│  └─ connectors/youtube/      # ingestion stub — the NATS node/edge.upsert contract
├─ docker-compose.yml          # neo4j · pgvector postgres · NATS JetStream · services
└─ README.md
```

## Architecture

```
                    ┌────────────────────────────┐
                    │   apps/web  (Next.js)      │
                    │   graph canvas = the UI    │
                    └─────────────┬──────────────┘
                                  │ GraphQL
                   ┌──────────────┼───────────────┐
                   │ GraphQL      │ /ingest       │
            ┌──────▼──────┐ ┌─────▼─────┐  ┌──────▼───────┐
            │   gateway   │ │ extractor │─▶│ Claude API   │
            │    :4000    │ │   :4003   │  │ (messages)   │
            └──────┬──────┘ └─────┬─────┘  └──────────────┘
                   │ REST         │ writes thoughts+concepts
              ┌────▼─────────┐ ┌──▼─────────────┐
              │ graph-service│ │  recommender   │
              │    :4001     │ │     :4002      │
              └───┬─────────┬┘ └───────┬────────┘
                  │         │               │
            ┌─────▼───┐ ┌───▼──────────┐    │ embeddings (BGE-M3)
            │  Neo4j  │ │  Postgres +  │◄───┘ + personalized PageRank
            │   (CE)  │ │   pgvector   │
            └─────────┘ └──────────────┘
                  ▲
                  │  graph.node.upsert / graph.edge.upsert
            ┌─────┴──────────── NATS JetStream ───────────────┐
            │ connectors: youtube · instagram · news · market… │
            └──────────────────────────────────────────────────┘
```

**Why the frontend works without any of this:** `apps/web/src/lib/dataSource.ts`
is the single seam. Mock mode generates the identical `Dataset` shape in the
browser that `graph-service` serves over HTTP — so the whole backend can be
swapped in later without touching a component.

## Node & edge taxonomy

| Node type | Examples in seed | Edge from a person |
| --- | --- | --- |
| `person` | You, Sara, Niloofar, Marco… | `FRIENDS_WITH` |
| `book` | Sapiens, بوف کور · The Blind Owl | `READS` |
| `news` | "EU finalises AI Act enforcement rules" | `READS` |
| `music` | Radiohead, Homayoun Shajarian | `LISTENS_TO` |
| `video` | YouTube · 3Blue1Brown | `WATCHES` |
| `social_account` | @A24, @honargardi (Instagram/X) | `FOLLOWS` |
| `post` | "Yalda table at my grandmother's ❤️" | `LIKES` / authored via `POSTED` |
| `movie` | A Separation · جدایی نادر از سیمین | `WATCHES` |
| `financial_signal` | BTC/USD, NVDA, USD/IRR, TEDPIX | `TRACKS` |
| `location` | Tajrish Bazaar, Tokyo · Shibuya | `VISITED` |
| `thought` | an article or note you wrote | `REFLECTS_ON` |
| `concept` | ideas Claude extracts (attention, reflexivity…) | `MENTIONS` |

System & semantic edges: `MENTIONS` (thought → entity), `RELATES_TO`
(concept ↔ concept, carrying the relation phrase), `REFLECTS_ON`
(you → thought).

System edges: `RECOMMENDED` (gold, dashed) carries `score`, `via[]` and a
human-readable `reason` — recommendations are explainable **by construction**,
not post-hoc.

## Roadmap

1. **Phase 1 — this repo.** Frontend-first product: the five views (Universe,
   Circles, Discover, Path, Write), lens, inspector, explainable Discover,
   the live action vocabulary, **Claude-powered thought extraction**, and a
   seeded bilingual universe. Service skeletons pin the API contracts.
2. **Phase 2 — real storage.** ✅ graph-service is backed by **Neo4j CE**
   (`store.ts`) — the seed world is persisted and survives restarts. Still
   ahead: auth service (OIDC), per-user graphs, gateway federation.
3. **Phase 3 — live recommendation.** BGE-M3 embeddings (multilingual:
   Persian + English labels in the seed are deliberate) in pgvector — the
   `concept` nodes Claude already extracts are the natural thing to embed,
   so thoughts feed taste. Personalized PageRank for serendipity,
   event-driven re-ranking from NATS.
4. **Phase 4 — connectors & growth.** YouTube/Instagram OAuth ingestion via
   the `node.upsert`/`edge.upsert` contract, market-data feed, places
   check-ins, shared circles between users, 3D view toggle.

## Decisions taken (and how to override)

| Decision | Choice | Override |
| --- | --- | --- |
| Build order | Frontend prototype first; services as runnable skeletons | Flesh out any service — contracts are pinned |
| Canvas | 2D (readable, fast). 3D is a view-toggle away | `react-force-graph-3d` drops into `GraphCanvas` |
| UI language | English UI; Persian-ready (Vazirmatn font stack, RTL-safe labels, Persian content in seed) | i18n layer (e.g. `next-intl`) over the same components |
| Mock identity | Center node is "You" | Replace in `packages/graph-core/src/seed.ts` |
