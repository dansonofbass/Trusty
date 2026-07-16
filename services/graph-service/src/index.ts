/**
 * graph-service — owns the social graph (multi-user).
 *
 * ONE shared entity graph + PER-USER overlay. The shared nodes/edges live in a
 * working copy (durable in Neo4j when NEO4J_URI is set); each user has their own
 * root node, wallet, and dismissed list. Every request carries `X-User-Id`
 * (forwarded by the BFF/gateway over the internal network); the service builds
 * that user's view, runs the same pure functions the browser uses, and persists.
 *
 *   storage model (see store.ts):
 *     (:Entity)-[:REL {type,...}]->(:Entity)   +   (:Meta {userId, meId, dismissed, wallet})
 */
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import express from "express";
import cors from "cors";
import {
  acceptRecommendation,
  addEdge,
  addInviteEdge,
  addTrustEdge,
  addUserEntityLink,
  applyOutcomeToEdge,
  buildDataset,
  buyTokens,
  computeCommunities,
  computeTrustRecommendations,
  rankCandidates,
  RANKING_CONFIG,
  createRecommendation,
  attachOutcome,
  outcomesForRecommendation,
  recommendationsForTarget,
  recommendationConsensus,
  listenCapacity,
  listenSuggestions,
  addListenEdge,
  removeListenEdge,
  listeningTo,
  listenersOf,
  activeListenCount,
  isListening,
  recommendationsFromListened,
  haversineKm,
  createEntity,
  updateEntity,
  upsertProfile,
  hasRole,
  createPost,
  dismissRecommendation,
  ENTITY_TYPES,
  allEntityTypes,
  appForEntityType,
  getOntology,
  scopeToApp,
  setCustomOntology,
  getCustomOntology,
  whoToMeet,
  rankedSearch,
  materializeTags,
  BUILTIN_APP,
  earnTokens,
  egoIds,
  ingestThought,
  newUserRoot,
  refreshDerived,
  removeEdge,
  removeTrustEdge,
  removeUserEntityLink,
  spendTokens,
  toGraph,
  topicForEntityType,
  TOPIC_PARENT,
  viewForUser,
  NATS_SUBJECTS,
  type Dataset,
  type EntityLinkType,
  type GLink,
  type GNode,
  type MeetMode,
  type TrustQuery,
  type TrustScope,
  type WalletEntry,
} from "@constellation/graph-core";
import {
  createStore,
  defaultWallet,
  type GraphStore,
  type SharedGraph,
  type UserMeta,
} from "./store";
import { startNatsIngest } from "./nats";
import {
  getWriting,
  initWritings,
  listWritings,
  recordWoven,
  saveDraft,
  writingsEnabled,
} from "./writings";
import { initTrustLog, outcomeStats, recordOutcome, trustLogEnabled } from "./trustLog";
import { initReputation, reputationEnabled, reputationIndex } from "./reputation";
import {
  initListen,
  listenEnabled,
  LISTEN_CONFIG,
  createRequest,
  getRequest,
  incomingRequests,
  outgoingRequests,
  resolveRequest,
  markAccepted,
  getPolicy,
  setPolicy,
  type ListenPolicy,
} from "./listen";
import {
  initRelationshipStrength,
  relationshipStrengthEnabled,
  strengthMap,
} from "./relationshipStrength";
import {
  initContribution,
  contributionLedgerEnabled,
  contributionOverview,
  contributionSummaryFor,
  contributionValueFor,
  sanitizeContributionOverride,
  CONTRIBUTION_ENV,
} from "./contribution";
import {
  initCredits,
  creditsEnabled,
  earnedCredits,
  ledgerSum,
  creditHistory,
  grantCredits,
  activeBoostSlots,
  spendForBoost,
  CREDITS_CONFIG,
} from "./credits";
import { initSavedPlaces, isSaved, listSaved, savePlace, savedPlacesEnabled, unsavePlace } from "./savedPlaces";
import {
  initPlaceSuggestions, placeSuggestionsEnabled, createSuggestion, listSuggestions, getSuggestion, setSuggestionStatus,
} from "./placeSuggestions";
import {
  consumeInvite,
  createInvite,
  getInvite,
  initInvites,
  inviteStats,
  invitesEnabled,
  listInvitesFor,
  recordVisit,
  INVITE_DEFAULT_MAX_USES,
} from "./invites";
import {
  accessEnabled,
  bindInvite,
  bindWaitlist,
  ensureAccess,
  getAccess,
  initAccess,
  listAccess,
  setStatus,
} from "./access";
import {
  adminUnlock,
  getWaitlistByUser,
  incrementReferral,
  initWaitlist,
  joinWaitlist,
  listWaitlist,
  waitlistEnabled,
  WAITLIST_UNLOCK_THRESHOLD,
} from "./waitlist";
import {
  completeOnboarding,
  getOnboarding,
  initOnboarding,
  onboardingEnabled,
  saveStep,
  type OnboardingStep,
} from "./onboarding";
import {
  createPrompt,
  initOutcomePrompts,
  outcomePromptsEnabled,
  pendingPrompts,
  resolvePrompt,
} from "./outcomePrompts";
import {
  asksEnabled,
  asksInbox,
  createAsk,
  getAsk,
  initAsks,
  myAsks,
  recordAnswer,
} from "./asks";
import { embeddingsEnabled, initEmbeddings, similarTopics } from "./embeddings";
import { applyRecommendations, recommenderConfigured } from "./recommenderClient";
import { initSearchLog, recordSearch, searchLogEnabled } from "./searchLog";
import {
  initInteractionLog,
  interactionLogEnabled,
  recordInteraction,
  recordInteractions,
  type InteractionInput,
  type InteractionKind,
} from "./interactionLog";
import { JSONCodec, type NatsConnection } from "nats";
import {
  initPlaceLinks, placeLinksEnabled, createPlaceLink, resolvePlaceLink, listPlaceLinks, deletePlaceLink,
} from "./placeLinks";
import {
  initOntology, loadOntology, ontologyEnabled,
  listApps, upsertApp, deleteApp,
  upsertEntityType, deleteEntityType,
  upsertRelation, deleteRelation,
} from "./ontologyStore";
import { initMeetings, meetingsEnabled, createMeeting, respondMeeting, myMeetings } from "./meetings";
import {
  initMeetingNotes, notesEnabled, createNote, updateNote, deleteNote,
  notesForPair, notesByAuthor, notesAbout, normalizeVisibility,
  type MeetingNote, type NoteVisibility,
} from "./meetingNotes";
import { initEventLocations, locationsEnabled, listLocations, upsertLocation, deleteLocation } from "./eventLocations";

/** Reload the admin-defined ontology overlay into graph-core (boot + after edits). */
async function reloadOntology(): Promise<void> {
  setCustomOntology(await loadOntology());
}

/** Which maps provider a submitted URL belongs to (google | yandex | null). */
function detectLinkSource(url: string): "google" | "yandex" | null {
  const u = url.toLowerCase();
  if (u.includes("google.") || u.includes("goo.gl")) return "google";
  if (u.includes("yandex.")) return "yandex";
  return null;
}

try {
  const here = dirname(fileURLToPath(import.meta.url));
  (process as NodeJS.Process & { loadEnvFile?: (p: string) => void }).loadEnvFile?.(
    resolve(here, "../../../.env"),
  );
} catch {
  /* no repo-root .env — rely on the ambient environment */
}

const PORT = Number(process.env.PORT ?? 4001);
const NATS_URL = process.env.NATS_URL?.trim();

const app = express();
app.use(cors());
app.use(express.json());

// Assigned during bootstrap, before the server starts listening.
let store: GraphStore;
let shared: SharedGraph; // the shared substrate (nodes + links)
let graph: ReturnType<typeof toGraph>;
let graphVersion = 0; // bumped on every structural change (rec + community cache key)
let natsConn: NatsConnection | undefined;
const userMeta = new Map<string, UserMeta>(); // per-user cache

/** Serialize writes so concurrent requests can't interleave persists. */
let writeChain: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn);
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

const asError = (e: unknown) => ({ error: e instanceof Error ? e.message : String(e) });
const stripMe = (n: GNode): GNode => (n.isMe ? { ...n, isMe: undefined } : n);
const endId = (v: string | GNode): string => (typeof v === "string" ? v : v.id);
/** Dietary tags allowed on a menu_item (mirrors the restaurant ontology). */
const DIETARY_OPTIONS = new Set(["vegetarian", "vegan", "halal", "kosher", "gluten_free"]);

const normLabel = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
/** Resolve a free-text name to a node id (normalized label match). */
function findNodeIdByName(nodes: GNode[], name: string): string | undefined {
  const n = normLabel(name);
  return nodes.find((x) => normLabel(x.label) === n)?.id;
}

/** A trust suggestion the user confirmed in the Write flow. */
interface TrustAssertionInput {
  object: string;
  objectId?: string;
  scope: TrustScope;
  reasons?: string[];
  confidence?: number;
}

function rebuildGraph(): void {
  graph = toGraph(shared.nodes, shared.links);
  graphVersion++; // every structural change bumps this (cache key for recs + communities)
}

/**
 * Server-side Louvain communities over the shared union, recomputed lazily once
 * per graph-version (not per request — the browser used to redo this every
 * render). Feeds the `community` blend channel and the Circles UI.
 */
let communitiesCache: { version: number; byNode: Record<string, number>; infos: ReturnType<typeof computeCommunities>["infos"] } | null = null;
function getCommunities(): { byNode: Record<string, number>; infos: ReturnType<typeof computeCommunities>["infos"] } {
  if (!communitiesCache || communitiesCache.version !== graphVersion) {
    const { byNode, infos } = computeCommunities(graph, shared.nodes);
    communitiesCache = { version: graphVersion, byNode, infos };
  }
  return { byNode: communitiesCache.byNode, infos: communitiesCache.infos };
}

/* ---- Blended recommendations: recommender service + recompute-on-write cache ---- */
const RECOMMENDER_ENABLED = process.env.RECOMMENDER_ENABLED !== "0" && recommenderConfigured();

// Per-user recommendation cache. Keyed by graphVersion — any structural change
// bumps it, lazily invalidating every user's entry on next read; a user's own
// meta change (dismiss) deletes their entry directly.
const recCache = new Map<string, { version: number; recs: Dataset["recommendations"] }>();
function invalidateUser(userId: string): void {
  recCache.delete(userId);
}

/** The viewer's recommendations: cache → recommender (blended) → structural fallback. */
async function recommendationsFor(userId: string, view: Dataset): Promise<Dataset["recommendations"]> {
  const cached = recCache.get(userId);
  if (cached && cached.version === graphVersion) return cached.recs;
  let recs = view.recommendations; // structural baseline (already computed by viewFor)
  if (RECOMMENDER_ENABLED) {
    try {
      const blended = await applyRecommendations(view, { communityByNode: getCommunities().byNode });
      recs = blended.recommendations;
    } catch {
      /* recommender unreachable → keep the structural baseline */
    }
  }
  recCache.set(userId, { version: graphVersion, recs });
  return recs;
}

/**
 * The viewer's WORKING dataset: the full shared union (every user's edges) with
 * their root marked `isMe`. Mutations run over this so consensus promotion and
 * the trust fabric can see the whole graph; the result is narrowed by `viewFor`
 * before it ships to the client, so a commit never drops another user's edges.
 */
function workingSet(userId: string, meta: UserMeta): Dataset {
  const nodes = shared.nodes.map((n) =>
    n.id === userId ? { ...n, isMe: true } : n.isMe ? { ...n, isMe: undefined } : n,
  );
  return refreshDerived({
    nodes,
    links: shared.links,
    meId: userId,
    recommendations: [],
    dismissed: meta.dismissed,
    wallet: meta.wallet,
  });
}

/**
 * The viewer's CANVAS dataset: the shared catalog + only their own personal
 * edges (the per-user overlay), derived over that slice. This is what every read
 * endpoint and every mutation response returns — a stranger's private edges
 * never cross the wire.
 */
function viewFor(userId: string, meta: UserMeta, app?: string): Dataset {
  const view = viewForUser(
    {
      nodes: shared.nodes,
      links: shared.links,
      meId: userId,
      recommendations: [],
      dismissed: meta.dismissed,
      wallet: meta.wallet,
    },
    userId,
  );
  // App layering: keep the shared person layer + only this app's entities.
  return app ? scopeToApp(view, app) : view;
}

/** The App (Space) a read is scoped to — from ?app= or x-app header, default general. */
const appOf = (req: express.Request): string =>
  ((typeof req.query.app === "string" ? req.query.app : "") || req.header("x-app") || "").trim() || BUILTIN_APP;

/** Persist a user's meta (wallet + dismissed) and update the cache. */
async function persistMeta(userId: string, next: Dataset): Promise<UserMeta> {
  const meta: UserMeta = {
    meId: userId,
    dismissed: next.dismissed ?? [],
    wallet: next.wallet ?? defaultWallet(),
  };
  userMeta.set(userId, meta);
  await store.persistUserMeta(userId, meta);
  return meta;
}

/** Commit a structural mutation: update the shared graph + the user's meta. */
async function commitGraph(userId: string, next: Dataset): Promise<Dataset> {
  shared = { nodes: next.nodes.map(stripMe), links: next.links };
  rebuildGraph();
  await store.persistGraph(shared);
  const meta = await persistMeta(userId, next);
  return viewFor(userId, meta);
}

/** Commit a per-user-only mutation (wallet / dismissed) — no graph write. */
async function commitMeta(userId: string, next: Dataset): Promise<Dataset> {
  const meta = await persistMeta(userId, next);
  invalidateUser(userId); // dismiss changes their recs but doesn't bump graphVersion
  return viewFor(userId, meta);
}

/** Commit a shared-graph mutation with no acting user (NATS connectors). */
async function commitShared(next: Dataset): Promise<Dataset> {
  shared = { nodes: next.nodes.map(stripMe), links: next.links };
  rebuildGraph();
  await store.persistGraph(shared);
  return next;
}

/** Materialize a user on first sight: a root node + starter galaxy + wallet. */
async function ensureUser(
  userId: string,
  profile: { name?: string; email?: string },
): Promise<UserMeta> {
  const desiredLabel = profile.name?.trim();
  const cached = userMeta.get(userId);
  const existing = shared.nodes.find((n) => n.id === userId);
  if (cached && existing) {
    // Relabel an already-created root once the real name arrives (one-time).
    if (desiredLabel && existing.label !== desiredLabel) {
      await serialize(async () => {
        shared = {
          nodes: shared.nodes.map((n) =>
            n.id === userId ? { ...n, label: desiredLabel, sub: profile.email ?? n.sub } : n,
          ),
          links: shared.links,
        };
        rebuildGraph();
        await store.persistGraph(shared);
      });
    }
    // Established user — grandfather them past the invite-only gate.
    await ensureAccess(userId, "active");
    return cached;
  }

  return serialize(async () => {
    // re-check inside the write lock (another request may have created it)
    const again = userMeta.get(userId);
    const nodeExists = shared.nodes.some((n) => n.id === userId);
    if (again && nodeExists) {
      await ensureAccess(userId, "active");
      return again;
    }

    // A user we've never materialized is brand-new → invite-only gate applies
    // (default `waitlisted`); a pre-existing node is an established user.
    const brandNew = !nodeExists;
    if (!nodeExists) {
      const { node, links } = newUserRoot(shared, userId, profile);
      shared = { nodes: [...shared.nodes, node], links: [...shared.links, ...links] };
      rebuildGraph();
      await store.persistGraph(shared);
    }
    let meta = again ?? (await store.loadUserMeta(userId));
    if (!meta) {
      meta = { meId: userId, dismissed: [], wallet: defaultWallet() };
      await store.persistUserMeta(userId, meta);
    }
    await ensureAccess(userId, brandNew ? "waitlisted" : "active");
    userMeta.set(userId, meta);
    return meta;
  });
}

const decodeHeader = (v?: string): string | undefined => {
  if (!v) return undefined;
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
};

/** Trim + length-cap an untrusted string field; undefined when empty/absent. */
const str = (v: unknown, max: number): string | undefined => {
  if (typeof v !== "string") return undefined;
  const t = v.trim().slice(0, max);
  return t || undefined;
};

/**
 * Apply the basic onboarding profile to the user's own node (identity, not a
 * relationship): sets the display label + stores city/language/known-topics/
 * looking-for in `properties`. Intentionally does NOT use `upsertProfile` (which
 * would force an expertise role — forbidden during onboarding). Deterministic.
 */
function applyOnboardingProfile(
  d: Dataset,
  userId: string,
  ob: { profile?: { name?: string; city?: string; language?: string; photo?: string }; topics?: string[]; lookingFor?: string[] },
): Dataset {
  const node = d.nodes.find((n) => n.id === userId);
  if (!node) return d;
  const p = ob.profile ?? {};
  const properties: Record<string, unknown> = {
    ...(node.properties ?? {}),
    ...(p.city ? { city: p.city } : {}),
    ...(p.language ? { language: p.language } : {}),
    ...(p.photo ? { photo: p.photo } : {}),
    ...(ob.topics?.length ? { known_topics: ob.topics } : {}),
    ...(ob.lookingFor?.length ? { looking_for: ob.lookingFor } : {}),
  };
  if (properties.joined_at == null) properties.joined_at = Date.now();
  const label = p.name?.trim() || node.label;
  const updated: GNode = { ...node, label, properties, ...(p.photo ? { photos: [p.photo] } : {}) };
  return refreshDerived({ ...d, nodes: d.nodes.map((n) => (n.id === userId ? updated : n)) });
}

interface AuthedRequest extends express.Request {
  auth?: { userId: string; meta: UserMeta };
}

/* ------------------------------ health ----------------------------- */

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "graph-service",
    storage: store?.kind ?? "starting",
    nats: NATS_URL ? (natsConn ? "connected" : "connecting") : "disabled",
    nodes: shared?.nodes.length ?? 0,
    edges: shared?.links.length ?? 0,
    users: userMeta.size,
    writings: writingsEnabled() ? "postgres" : "disabled",
    trustLog: trustLogEnabled() ? "postgres" : "disabled",
    invites: invitesEnabled() ? "postgres" : "disabled",
    reputation: reputationEnabled() ? "postgres" : "disabled",
    relationshipStrength: relationshipStrengthEnabled() ? "postgres" : "priors-only",
    listen: listenEnabled() ? "postgres" : "disabled",
    contribution: contributionLedgerEnabled() ? "postgres" : "graph-derived-only",
    credits: creditsEnabled() ? "postgres" : "disabled",
    access: accessEnabled() ? "postgres" : "disabled",
    waitlist: waitlistEnabled() ? "postgres" : "disabled",
    onboarding: onboardingEnabled() ? "postgres" : "disabled",
    outcomePrompts: outcomePromptsEnabled() ? "postgres" : "disabled",
    asks: asksEnabled() ? "postgres" : "disabled",
    embeddings: embeddingsEnabled() ? "pgvector" : "disabled",
    searchLog: searchLogEnabled() ? "postgres" : "disabled",
    interactionLog: interactionLogEnabled() ? "postgres" : "disabled",
    savedPlaces: savedPlacesEnabled() ? "postgres" : "disabled",
    placeSuggestions: placeSuggestionsEnabled() ? "postgres" : "disabled",
    placeLinks: placeLinksEnabled() ? "postgres" : "disabled",
    recommender: RECOMMENDER_ENABLED ? "blended" : "inline",
  });
});

/* --------------------- invites (public landing meta) --------------------- */
/* Unauthenticated on purpose: the invite landing page is viewable logged-out.
 * Records a visit (funnel) and returns just the inviter's display name. */
app.get("/public/invites/:code", async (req, res) => {
  const code = String(req.params.code ?? "");
  try {
    const invite = await getInvite(code);
    if (!invite || invite.revoked) return res.json({ ok: false });
    await recordVisit(code, { ua: req.header("user-agent")?.slice(0, 120) });
    const inviter = shared.nodes.find((n) => n.id === invite.inviterId);
    res.json({ ok: true, code, inviter: { name: inviter?.label ?? "A friend" } });
  } catch (e) {
    res.status(500).json(asError(e));
  }
});

/* --------------------- auth (identity from the BFF) ---------------- */

app.use("/api", async (req, res, next) => {
  try {
    const userId = (req.header("x-user-id") || "").trim();
    if (!userId) return res.status(401).json({ error: "missing X-User-Id" });
    const meta = await ensureUser(userId, {
      name: decodeHeader(req.header("x-user-name")),
      email: decodeHeader(req.header("x-user-email")),
    });
    (req as AuthedRequest).auth = { userId, meta };
    next();
  } catch (e) {
    res.status(500).json(asError(e));
  }
});

const auth = (req: express.Request) => (req as AuthedRequest).auth!;

/* --------------------- ontology (apps / builder) ------------------- */

/** The admin-defined ontology overlay — the client merges it into its own built-ins. */
app.get("/api/ontology", (_req, res) => {
  res.json(getCustomOntology());
});

/** Admin builder — CRUD over the custom App / Entity-Type / Relation overlay.
 *  Admin-gated at the BFF (proxyGraphAdmin); each write reloads the registry. */
app.get("/api/admin/apps", async (_req, res) => {
  try {
    res.json({ apps: await listApps(), enabled: ontologyEnabled() });
  } catch (e) {
    res.status(500).json(asError(e));
  }
});

app.post("/api/admin/apps", async (req, res) => {
  auth(req);
  try {
    if (!ontologyEnabled()) return res.status(503).json({ error: "ontology store disabled (no DATABASE_URL)" });
    const created = await upsertApp(req.body ?? {});
    await reloadOntology();
    res.json(created);
  } catch (e) {
    res.status(400).json(asError(e));
  }
});

app.delete("/api/admin/apps/:slug", async (req, res) => {
  auth(req);
  try {
    await deleteApp(req.params.slug);
    await reloadOntology();
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json(asError(e));
  }
});

app.post("/api/admin/apps/:slug/entity-types", async (req, res) => {
  auth(req);
  try {
    if (!ontologyEnabled()) return res.status(503).json({ error: "ontology store disabled" });
    const type = await upsertEntityType(req.params.slug, req.body ?? {});
    await reloadOntology();
    res.json(type);
  } catch (e) {
    res.status(400).json(asError(e));
  }
});

app.delete("/api/admin/apps/:slug/entity-types/:id", async (req, res) => {
  auth(req);
  try {
    await deleteEntityType(req.params.slug, req.params.id);
    await reloadOntology();
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json(asError(e));
  }
});

app.post("/api/admin/apps/:slug/relations", async (req, res) => {
  auth(req);
  try {
    if (!ontologyEnabled()) return res.status(503).json({ error: "ontology store disabled" });
    const rel = await upsertRelation(req.params.slug, req.body ?? {});
    await reloadOntology();
    res.json(rel);
  } catch (e) {
    res.status(400).json(asError(e));
  }
});

app.delete("/api/admin/apps/:slug/relations/:id", async (req, res) => {
  auth(req);
  try {
    await deleteRelation(req.params.slug, req.params.id);
    await reloadOntology();
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json(asError(e));
  }
});

/* ---------------- admin: people & entities manager ----------------- */
/* List / edit / delete / import / export every node (persons + ontology
 * entities), separable by app. Admin-gated at the BFF. */

/** Merged ontology (built-ins + custom) → the app + entity-type pickers +
 *  the field schema the editor renders. */
app.get("/api/admin/entities/schema", (_req, res) => {
  const o = getOntology();
  const apps = [
    { slug: BUILTIN_APP, label: "Trusty (general)" },
    ...o.apps.filter((a) => a.slug !== BUILTIN_APP).map((a) => ({ slug: a.slug, label: a.label })),
  ];
  const entityTypes = o.entityTypes.map((t) => ({
    id: t.id, label: t.label, app: appForEntityType(t.id) ?? BUILTIN_APP,
    baseType: t.baseType, category: t.category ?? null, fields: t.fields,
  }));
  res.json({ apps, entityTypes });
});

/** Export matching entities as import-ready rows (round-trips with import). */
app.get("/api/admin/entities/export", (req, res) => {
  auth(req);
  const app = String(req.query.app ?? "");
  const type = String(req.query.type ?? "");
  const rows = shared.nodes
    .filter((n) => n.entityType)
    .filter((n) => !app || appForEntityType(n.entityType) === app)
    .filter((n) => !type || type === "person" || n.entityType === type)
    .map((n) => ({ entityType: n.entityType, label: n.label, properties: n.properties ?? {} }));
  res.json({ rows });
});

/** List people + entities, scoped to an app (persons are shared across apps).
 *  `type` = an entityType, or "person" for every person node. */
app.get("/api/admin/entities", (req, res) => {
  auth(req);
  const app = String(req.query.app ?? "");
  const type = String(req.query.type ?? "");
  const q = String(req.query.q ?? "").toLowerCase();
  let nodes = shared.nodes;
  if (app) nodes = nodes.filter((n) => inApp(n, app));
  if (type === "person") nodes = nodes.filter((n) => n.type === "person");
  else if (type) nodes = nodes.filter((n) => n.entityType === type);
  if (q) nodes = nodes.filter((n) => n.label.toLowerCase().includes(q) || (n.sub ?? "").toLowerCase().includes(q));
  res.json({
    total: nodes.length,
    nodes: nodes.slice(0, 1000).map((n) => ({
      id: n.id, label: n.label, sub: n.sub, type: n.type, entityType: n.entityType,
      app: n.entityType ? (appForEntityType(n.entityType) ?? null) : null,
      isMe: n.isMe === true, properties: n.properties ?? {}, photos: n.photos ?? [],
    })),
  });
});

/** Update any node's label + properties (schema-validated for ontology entities;
 *  free-form for role-less person nodes). */
app.put("/api/admin/entities/:id", async (req, res) => {
  auth(req);
  const id = String(req.params.id);
  const node = shared.nodes.find((n) => n.id === id);
  if (!node) return res.status(404).json({ error: "not found" });
  const label = typeof req.body?.label === "string" ? req.body.label : undefined;
  const properties = req.body?.properties && typeof req.body.properties === "object" ? (req.body.properties as Record<string, unknown>) : undefined;
  try {
    await serialize(async () => {
      let next;
      if (node.entityType) {
        next = updateEntity({ nodes: shared.nodes, links: shared.links, meId: "system", recommendations: [] }, { id, label, properties, now: Date.now() });
        next = refreshDerived(materializeTags(next, id)); // keep curated tags → concept nodes in sync
      } else {
        const nodes = shared.nodes.map((n) => n.id === id
          ? { ...n, label: label?.trim() || n.label, properties: properties ? { ...(n.properties ?? {}), ...properties } : n.properties }
          : n);
        next = refreshDerived({ nodes, links: shared.links, meId: "system", recommendations: [] });
      }
      await commitShared(next);
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json(asError(e));
  }
});

/** Delete any node + its PART_OF children (e.g. menu items) + all touching edges. */
app.delete("/api/admin/entities/:id", async (req, res) => {
  auth(req);
  const id = String(req.params.id);
  if (!shared.nodes.some((n) => n.id === id)) return res.status(404).json({ error: "not found" });
  try {
    await serialize(async () => {
      const children = new Set(shared.links.filter((l) => l.type === "PART_OF" && endId(l.target) === id).map((l) => endId(l.source)));
      const dead = new Set([id, ...children]);
      const nodes = shared.nodes.filter((n) => !dead.has(n.id));
      const links = shared.links.filter((l) => !dead.has(endId(l.source)) && !dead.has(endId(l.target)));
      await commitShared({ nodes, links, meId: "system", recommendations: [] });
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json(asError(e));
  }
});

/* ----- ontology relations between entities (MEMBER_OF, ADVISES, …) ----- */

const typeMatches = (etype: string | undefined, list: string[]) => list.includes("*") || (!!etype && list.includes(etype));

/** A node's relation edges (typed as an ontology relation id) + what's addable. */
app.get("/api/admin/entities/:id/relations", (req, res) => {
  auth(req);
  const id = String(req.params.id);
  const node = shared.nodes.find((n) => n.id === id);
  if (!node) return res.status(404).json({ error: "not found" });
  const defs = getOntology().relations;
  const relById = new Map(defs.map((d) => [d.id, d] as const));
  const byId = new Map(shared.nodes.map((n) => [n.id, n] as const));
  // ALL edges touching this node (matching what shows in the graph), not just
  // ontology relations — friendships, reads, trust, tag edges, member_of, …
  // (RECOMMENDED ghost edges are ephemeral, so skip them.)
  const relations = shared.links
    .filter((l) => String(l.type) !== "RECOMMENDED" && (endId(l.source) === id || endId(l.target) === id))
    .map((l) => {
      const out = endId(l.source) === id;
      const other = byId.get(out ? endId(l.target) : endId(l.source));
      const t = String(l.type);
      return {
        edgeId: l.id, relationId: t,
        label: relById.get(t)?.label ?? t.toLowerCase().replace(/_/g, " "),
        direction: out ? "out" : "in", otherId: other?.id, otherLabel: other?.label,
        otherType: other?.entityType ?? other?.type, ontology: relById.has(t),
      };
    })
    .filter((r) => r.otherId)
    .slice(0, 250);
  // Offer a relation only when this node EXPLICITLY matches a side, or matches by
  // wildcard toward a CONCRETE other side — drops pure "*"↔"*" noise (REFERS/NEAR).
  const available: { relationId: string; label: string; direction: "out" | "in"; otherTypes: string[] }[] = [];
  const et = node.entityType;
  for (const d of defs) {
    const fromExp = !!et && d.from.includes(et), toExp = !!et && d.to.includes(et);
    const fromWild = d.from.includes("*"), toWild = d.to.includes("*");
    if (fromExp || (fromWild && !toWild)) available.push({ relationId: d.id, label: d.label, direction: "out", otherTypes: d.to });
    if (toExp || (toWild && !fromWild)) available.push({ relationId: d.id, label: d.label, direction: "in", otherTypes: d.from });
  }
  available.sort((a, b) => (a.otherTypes.includes("*") ? 1 : 0) - (b.otherTypes.includes("*") ? 1 : 0)); // concrete first
  res.json({ relations, available });
});

/** Create an ontology relation edge (validated against the relation's from/to). */
app.post("/api/admin/relations", async (req, res) => {
  auth(req);
  const relationId = String(req.body?.relationId ?? "");
  const source = String(req.body?.source ?? "");
  const target = String(req.body?.target ?? "");
  const def = getOntology().relations.find((d) => d.id === relationId);
  if (!def) return res.status(400).json({ error: "unknown relation" });
  const s = shared.nodes.find((n) => n.id === source);
  const t = shared.nodes.find((n) => n.id === target);
  if (!s || !t) return res.status(404).json({ error: "unknown source/target" });
  if (s.id === t.id) return res.status(400).json({ error: "cannot relate a node to itself" });
  if (!typeMatches(s.entityType, def.from) || !typeMatches(t.entityType, def.to)) {
    return res.status(400).json({ error: `${relationId} must go ${def.from.join("/")} → ${def.to.join("/")}` });
  }
  try {
    await serialize(async () => {
      const edgeId = `rel_${relationId}_${source}_${target}`;
      if (shared.links.some((l) => l.id === edgeId)) return; // idempotent
      const link: GLink = { id: edgeId, source, target, type: relationId as GLink["type"], weight: 1, scope: "global" };
      await commitShared(refreshDerived({ nodes: shared.nodes, links: [...shared.links, link], meId: "system", recommendations: [] }));
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json(asError(e));
  }
});

/** Remove a relation edge. */
app.delete("/api/admin/relations/:edgeId", async (req, res) => {
  auth(req);
  const edgeId = String(req.params.edgeId);
  try {
    await serialize(async () => {
      await commitShared(refreshDerived({ nodes: shared.nodes, links: shared.links.filter((l) => l.id !== edgeId), meId: "system", recommendations: [] }));
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json(asError(e));
  }
});

/* ------------------------------ reads ------------------------------ */

/** The viewer's universe (bounded client-side by the visibility model). */
app.get("/api/graph", async (req, res) => {
  const { userId, meta } = auth(req);
  const view = viewFor(userId, meta, appOf(req));
  view.recommendations = await recommendationsFor(userId, view);
  res.json(view);
});

/** True when a node belongs to an App's space (persons + non-entities are shared). */
const inApp = (n: GNode, app: string): boolean =>
  n.type === "person" || !n.entityType || appForEntityType(n.entityType) === app;

/** Ego network around a node over the shared graph, BFS up to ?depth. */
app.get("/api/ego/:id", (req, res) => {
  const { id } = req.params;
  if (!graph.hasNode(id)) return res.status(404).json({ error: "unknown node" });
  const app = appOf(req);
  const depth = Math.min(3, Math.max(1, Number(req.query.depth ?? 2)));
  const ids = egoIds(graph, id, depth);
  const nodes = shared.nodes.filter((n) => ids.has(n.id) && inApp(n, app));
  const kept = new Set(nodes.map((n) => n.id));
  const links = shared.links.filter((l) => {
    const s = typeof l.source === "string" ? l.source : l.source.id;
    const t = typeof l.target === "string" ? l.target : l.target.id;
    return kept.has(s) && kept.has(t);
  });
  res.json({ center: id, depth, nodes, links });
});

/** Explainable recommendations for the authenticated viewer. */
app.get("/api/recommendations/:id", async (req, res) => {
  const { userId, meta } = auth(req);
  res.json(await recommendationsFor(userId, viewFor(userId, meta)));
});

/** Server-computed Louvain communities (shared union) — cached per graph-version. */
app.get("/api/communities", (_req, res) => {
  res.json(getCommunities());
});

/** Label/sub substring search over the shared graph, scoped to the active App. */
app.get("/api/search", (req, res) => {
  const q = String(req.query.q ?? "").toLowerCase();
  if (q.length < 2) return res.json([]);
  const app = appOf(req);
  res.json(
    shared.nodes
      .filter((n) => inApp(n, app) && (n.label.toLowerCase().includes(q) || (n.sub ?? "").toLowerCase().includes(q)))
      .slice(0, 12),
  );
});

/* ----------------------------- writes ------------------------------ */

app.post("/api/edges", async (req, res) => {
  const { userId, meta } = auth(req);
  const { source, target } = req.body ?? {};
  const other = String(source) === userId ? String(target) : String(source);
  const otherNode = shared.nodes.find((n) => n.id === other);
  if (otherNode)
    void recordInteraction({ userId, nodeId: other, kind: otherNode.type === "person" ? "befriend" : "add_to_sky" });
  try {
    res.json(
      await serialize(() =>
        commitGraph(userId, addEdge(workingSet(userId, meta), String(source), String(target), userId)),
      ),
    );
  } catch (e) {
    res.status(400).json(asError(e));
  }
});

app.delete("/api/edges", async (req, res) => {
  const { userId, meta } = auth(req);
  const { source, target } = req.body ?? {};
  try {
    res.json(
      await serialize(() =>
        commitGraph(userId, removeEdge(workingSet(userId, meta), String(source), String(target), userId)),
      ),
    );
  } catch (e) {
    res.status(400).json(asError(e));
  }
});

app.post("/api/posts", async (req, res) => {
  const { userId, meta } = auth(req);
  const { label } = req.body ?? {};
  try {
    res.json(
      await serialize(() =>
        commitGraph(userId, createPost(workingSet(userId, meta), userId, String(label ?? ""))),
      ),
    );
  } catch (e) {
    res.status(400).json(asError(e));
  }
});

/** Ingest a thought authored by the viewer (earns tokens server-side). */
app.post("/api/thoughts", async (req, res) => {
  const { userId, meta } = auth(req);
  const { text, extraction, originalExtraction, writingId, trustAssertions } = req.body ?? {};
  try {
    const accepted = extraction ?? { entities: [], relations: [] };
    const assertions: TrustAssertionInput[] = Array.isArray(trustAssertions) ? trustAssertions : [];
    const result = await serialize(async () => {
      const ingest = ingestThought(workingSet(userId, meta), userId, String(text ?? ""), accepted);
      let next = ingest.dataset;
      const { thoughtId, conceptIds } = ingest;
      // Fold the user-confirmed trust suggestions (Doc §15 — explicit confirm only).
      const now = Date.now();
      for (const a of assertions) {
        const targetId =
          (a.objectId && next.nodes.some((n) => n.id === a.objectId) ? a.objectId : undefined) ??
          findNodeIdByName(next.nodes, String(a.object ?? ""));
        if (!targetId || targetId === userId) continue;
        try {
          next = addTrustEdge(next, userId, targetId, a.scope, {
            confidence: a.confidence,
            reasons: a.reasons,
            source: "extracted",
            evidence: [thoughtId],
            now,
          });
        } catch {
          /* skip an assertion that doesn't resolve to a valid edge */
        }
      }
      const view = await commitGraph(userId, next);
      return { view, thoughtId, conceptIds };
    });
    // Durable, logged record of the writing (Postgres) — best-effort. The
    // writing id is the draft id when resumed, else the graph node id.
    const node = shared.nodes.find((n) => n.id === result.thoughtId);
    await recordWoven({
      id: writingId ? String(writingId) : result.thoughtId,
      thoughtId: result.thoughtId,
      userId,
      title: node?.label,
      body: String(text ?? ""),
      extraction: accepted,
      originalExtraction: originalExtraction ?? undefined,
    });
    res.json({ ...result.view, _ingested: { thoughtId: result.thoughtId, conceptIds: result.conceptIds } });
  } catch (e) {
    res.status(400).json(asError(e));
  }
});

/** Save/update a draft writing (before it's accepted into the graph). */
app.post("/api/writings/draft", async (req, res) => {
  const { userId } = auth(req);
  const { id, title, body, extraction } = req.body ?? {};
  if (!id || typeof body !== "string") return res.status(400).json({ error: "id and body required" });
  try {
    await saveDraft({
      id: String(id),
      userId,
      title: typeof title === "string" ? title : undefined,
      body,
      extraction: extraction ?? { entities: [], relations: [] },
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json(asError(e));
  }
});

/** The viewer's writings (Postgres log) — newest first. */
app.get("/api/writings", async (req, res) => {
  const { userId } = auth(req);
  try {
    res.json(await listWritings(userId));
  } catch (e) {
    res.status(500).json(asError(e));
  }
});

/** One writing with its full content + event log (edits, weaves, …). */
app.get("/api/writings/:id", async (req, res) => {
  const { userId } = auth(req);
  try {
    const w = await getWriting(userId, String(req.params.id));
    if (!w) return res.status(404).json({ error: "not found" });
    res.json(w);
  } catch (e) {
    res.status(500).json(asError(e));
  }
});

app.post("/api/recommendations/:userId/accept", async (req, res) => {
  const { userId, meta } = auth(req);
  void recordInteraction({ userId, nodeId: String(req.body?.nodeId), kind: "accept" });
  try {
    res.json(
      await serialize(() =>
        commitGraph(userId, acceptRecommendation(workingSet(userId, meta), String(req.body?.nodeId))),
      ),
    );
  } catch (e) {
    res.status(400).json(asError(e));
  }
});

app.post("/api/recommendations/:userId/dismiss", async (req, res) => {
  const { userId, meta } = auth(req);
  // Keep `dismissed` as the fast hard-exclusion set on :Meta AND log a timestamped
  // event (feeds fatigue / decay in the affinity profile).
  void recordInteraction({ userId, nodeId: String(req.body?.nodeId), kind: "dismiss" });
  try {
    res.json(
      await serialize(() =>
        commitMeta(userId, dismissRecommendation(workingSet(userId, meta), String(req.body?.nodeId))),
      ),
    );
  } catch (e) {
    res.status(400).json(asError(e));
  }
});

/** User-scoped entity link (SAME_AS / RELATES_TO); promotes to global by consensus. */
app.post("/api/entity-links", async (req, res) => {
  const { userId, meta } = auth(req);
  const { source, target, type, label } = req.body ?? {};
  try {
    res.json(
      await serialize(() =>
        commitGraph(
          userId,
          addUserEntityLink(
            workingSet(userId, meta),
            userId,
            String(source),
            String(target),
            type as EntityLinkType,
            typeof label === "string" ? label : undefined,
          ),
        ),
      ),
    );
  } catch (e) {
    res.status(400).json(asError(e));
  }
});

app.delete("/api/entity-links", async (req, res) => {
  const { userId, meta } = auth(req);
  const { linkId } = req.body ?? {};
  try {
    res.json(
      await serialize(() =>
        commitGraph(userId, removeUserEntityLink(workingSet(userId, meta), userId, String(linkId))),
      ),
    );
  } catch (e) {
    res.status(400).json(asError(e));
  }
});

/** Create an ontology entity (provider/place) with typed properties. */
app.post("/api/entity", async (req, res) => {
  const { userId, meta } = auth(req);
  const { entityType, label, properties } = req.body ?? {};
  try {
    let nodeId = "";
    const view = await serialize(async () => {
      const r = createEntity(workingSet(userId, meta), {
        entityType: String(entityType),
        label: String(label ?? ""),
        properties: (properties ?? {}) as Record<string, unknown>,
        now: Date.now(),
      });
      nodeId = r.nodeId;
      // No-op unless the entity type has curated tag fields (startups do).
      return commitGraph(userId, refreshDerived(materializeTags(r.dataset, nodeId)));
    });
    res.json({ ...view, _entity: { nodeId } });
  } catch (e) {
    res.status(400).json(asError(e));
  }
});

/* -------------------------- summit / profiles ---------------------- */

/** Upsert the signed-in person's own profile — one person, MANY active roles
 *  (`roles[0]` = primary shown on the graph; all roles searchable/matchable). */
app.post("/api/profile", async (req, res) => {
  const { userId, meta } = auth(req);
  const { entityType, roles, label, properties } = req.body ?? {};
  try {
    const view = await serialize(() => {
      const next = upsertProfile(workingSet(userId, meta), {
        personId: userId,
        entityType: entityType ? String(entityType) : undefined,
        roles: Array.isArray(roles) ? roles.map(String) : undefined,
        label: label ? String(label) : undefined,
        properties: (properties ?? {}) as Record<string, unknown>,
        now: Date.now(),
      });
      // Hybrid model: sync this profile's curated tags into shared concept
      // nodes + USES/NEEDS/OFFERS/INTERESTED_IN edges (diffed, idempotent).
      return commitGraph(userId, refreshDerived(materializeTags(next, userId)));
    });
    const node = shared.nodes.find((n) => n.id === userId);
    res.json({ ...view, _profile: node });
  } catch (e) {
    res.status(400).json(asError(e));
  }
});

/** The viewer's own node (their profile), for the Me tab / profile editor. */
app.get("/api/profile", (req, res) => {
  const { userId } = auth(req);
  res.json({ node: shared.nodes.find((n) => n.id === userId) ?? null });
});

/** Directory: people/orgs in an App, filterable by type / query / skill and by
 *  profile facets (industry / tech / country / stage) — "Find AI startups",
 *  "founders from Armenia", "startups at Seed stage" are all facet queries. */
app.get("/api/directory", (req, res) => {
  const app = appOf(req);
  const type = typeof req.query.type === "string" ? req.query.type : "";
  const q = String(req.query.q ?? "").toLowerCase();
  const slug = (v: unknown) => String(v ?? "").toLowerCase().replace(/\s+/g, "_");
  const skill = slug(req.query.skill);
  const industry = slug(req.query.industry);
  const tech = slug(req.query.tech);
  const country = slug(req.query.country);
  const stage = slug(req.query.stage);

  // Ranked mode — recommendation-style ordering (relevance + match-to-me +
  // link prediction) instead of a flat filter. Needs the viewer's identity.
  if (req.query.rank === "1" || req.query.rank === "true") {
    const { userId } = auth(req);
    const hits = rankedSearch(shared.nodes, shared.links, userId, {
      app,
      q: String(req.query.q ?? ""),
      filters: {
        type: type || undefined, industry: industry || undefined, tech: tech || undefined,
        country: country || undefined, stage: stage || undefined, skill: skill || undefined,
      },
      limit: Number(req.query.limit ?? 40),
    });
    const byId = new Map(shared.nodes.map((n) => [n.id, n]));
    const items = hits
      .map((h) => ({ node: byId.get(h.nodeId), matchPct: h.matchPct, score: h.score, reasons: h.reasons, factors: h.factors }))
      .filter((it) => it.node);
    return res.json({ app, count: items.length, ranked: true, hits: items, nodes: items.map((it) => it.node) });
  }

  /** Does any of `keys` hold `v` (multiselect containment or exact select)? */
  const propHas = (p: Record<string, unknown>, keys: string[], v: string): boolean =>
    keys.some((k) => {
      const val = p[k];
      return Array.isArray(val) ? val.map(String).includes(v) : String(val ?? "") === v;
    });

  const rows = shared.nodes.filter((n) => {
    if (!n.entityType || appForEntityType(n.entityType) !== app) return false;
    if (type && !hasRole(n, type)) return false; // any active role counts
    if (q && !(n.label.toLowerCase().includes(q) || (n.sub ?? "").toLowerCase().includes(q))) return false;
    const p = n.properties ?? {};
    if (skill && !propHas(p, ["skills_offered", "expertise"], skill)) return false;
    if (industry && !propHas(p, ["sectors", "industries", "interests", "topics"], industry)) return false;
    if (tech && !propHas(p, ["technologies"], tech)) return false;
    if (country && !propHas(p, ["country"], country)) return false;
    if (stage && !propHas(p, ["stage", "stages"], stage)) return false;
    return true;
  });
  res.json({ app, count: rows.length, nodes: rows });
});

/** Who to meet — match-based suggestions ("who should I meet next?"). */
app.get("/api/who-to-meet", (req, res) => {
  const { userId } = auth(req);
  const app = appOf(req);
  const suggestions = whoToMeet(shared.nodes, shared.links, userId, {
    app,
    mode: typeof req.query.mode === "string" ? (req.query.mode as MeetMode) : undefined,
    skill: typeof req.query.skill === "string" ? req.query.skill : undefined,
    limit: Number(req.query.limit ?? 24),
  });
  const byId = new Map(shared.nodes.map((n) => [n.id, n]));
  res.json({
    app,
    suggestions: suggestions.map((s) => ({ ...s, node: byId.get(s.nodeId) })).filter((s) => s.node),
  });
});

/** The Trusty Sevan Home feed — every discovery section in one round-trip. */
app.get("/api/home", (req, res) => {
  const { userId } = auth(req);
  const app = appOf(req);
  const byId = new Map(shared.nodes.map((n) => [n.id, n]));
  const hydrate = (s: { nodeId: string }) => ({ ...s, node: byId.get(s.nodeId) });

  const matchSection = (id: string, title: string, mode: MeetMode, limit = 12) => ({
    id,
    title,
    items: whoToMeet(shared.nodes, shared.links, userId, { app, mode, limit })
      .map(hydrate)
      .filter((s) => s.node),
  });

  // Recently joined — real join order (profiles stamp joined_at on first save).
  const recent = shared.nodes
    .filter((n) => n.type === "person" && n.entityType && appForEntityType(n.entityType) === app && n.id !== userId)
    .map((n) => ({ node: n, at: Number(n.properties?.joined_at ?? 0) }))
    .filter((x) => x.at > 0)
    .sort((a, b) => b.at - a.at)
    .slice(0, 12)
    .map((x) => ({ nodeId: x.node.id, node: x.node, reasons: ["recently joined"] }));

  // Trending startups — most saved/bookmarked.
  const savedCount = new Map<string, number>();
  for (const l of shared.links) {
    if (l.type !== "SAVED") continue;
    const t = typeof l.target === "string" ? l.target : l.target.id;
    savedCount.set(t, (savedCount.get(t) ?? 0) + 1);
  }
  const trending = shared.nodes
    .filter((n) => n.entityType === "startup" && (savedCount.get(n.id) ?? 0) > 0)
    .sort((a, b) => (savedCount.get(b.id) ?? 0) - (savedCount.get(a.id) ?? 0))
    .slice(0, 12)
    .map((n) => ({ nodeId: n.id, node: n, reasons: [`${savedCount.get(n.id)} bookmarks`] }));

  const sections = [
    matchSection("people_today", "People to meet today", "people"),
    matchSection("skills_wanted", "Looking for your skills", "skills_wanted"),
    matchSection("needs_my_offer", "They need what you offer", "needs_my_offer"),
    matchSection("startups", "Recommended startups", "startups"),
    matchSection("mentors", "Mentors for you", "mentors"),
    matchSection("investors", "Investors for you", "investors"),
    matchSection("partners", "Potential partners", "partners"),
    matchSection("api_customers", "Potential API customers", "api_customers"),
    matchSection("workshops", "Recommended workshops", "workshops"),
    { id: "recent", title: "Recently joined", items: recent },
    { id: "trending", title: "Trending startups", items: trending },
  ].filter((s) => s.items.length > 0);

  res.json({ app, sections });
});

/** Bookmark labels (Trusty Sevan F3) + the meeting lifecycle (F6). */
const CONTACT_LABELS = new Set([
  "interesting", "need_follow_up", "potential_partner", "potential_customer",
  "potential_investor", "potential_mentor", "potential_api_user",
]);
const LIFECYCLE_STAGES = [
  "discovered", "interested", "met", "conversation", "follow_up",
  "opportunity", "pilot", "partnership", "long_term", "trust",
] as const;

/** Save a contact (a one-directional SAVED edge) with an optional label + stage. */
app.post("/api/contacts", async (req, res) => {
  const { userId, meta } = auth(req);
  const body = req.body ?? {};
  const targetId = String(body.targetId ?? "");
  // A contact can carry SEVERAL reason tags (potential_investor + potential_mentor…).
  const raw = Array.isArray(body.labels) ? body.labels.map(String) : body.label != null ? [String(body.label)] : [];
  const labels = [...new Set(raw.filter((l) => CONTACT_LABELS.has(l)))];
  if (!labels.length) labels.push("interesting");
  const label = labels[0]; // primary (back-compat with anything reading a single label)
  const stage = (LIFECYCLE_STAGES as readonly string[]).includes(String(body.stage ?? "")) ? String(body.stage) : "interested";
  if (!targetId || targetId === userId) return res.status(400).json({ error: "bad target" });
  try {
    const view = await serialize(async () => {
      const ws = workingSet(userId, meta);
      if (!ws.nodes.some((n) => n.id === targetId)) throw new Error("unknown target");
      const edgeId = `saved_${userId}_${targetId}`;
      const existing = ws.links.find((l) => l.id === edgeId);
      const links = existing
        ? ws.links.map((l) => (l.id === edgeId ? { ...l, label, labels, stage: l.stage && l.stage !== "interested" ? l.stage : stage } : l))
        : [
            ...ws.links,
            { id: edgeId, source: userId, target: targetId, type: "SAVED" as const, scope: "user" as const, userId, weight: 1, label, labels, stage },
          ];
      return commitGraph(userId, refreshDerived({ ...ws, links }));
    });
    res.json(view);
  } catch (e) {
    res.status(400).json(asError(e));
  }
});

/** Advance a saved contact through the meeting lifecycle. Reaching the final
 *  "trust" stage is the ONLY trust write in Trusty Sevan — trust as an outcome. */
app.post("/api/contacts/:id/stage", async (req, res) => {
  const { userId, meta } = auth(req);
  const targetId = req.params.id;
  const stage = String((req.body ?? {}).stage ?? "");
  if (!(LIFECYCLE_STAGES as readonly string[]).includes(stage)) {
    return res.status(400).json({ error: `stage must be one of: ${LIFECYCLE_STAGES.join(", ")}` });
  }
  try {
    const view = await serialize(async () => {
      let ws = workingSet(userId, meta);
      const edgeId = `saved_${userId}_${targetId}`;
      if (!ws.links.some((l) => l.id === edgeId)) throw new Error("not a saved contact");
      ws = { ...ws, links: ws.links.map((l) => (l.id === edgeId ? { ...l, stage } : l)) };
      if (stage === "trust") {
        // The lifecycle's endpoint: a real topic-scoped trust edge.
        const target = ws.nodes.find((n) => n.id === targetId);
        const topic = target?.entityType ? topicForEntityType(target.entityType) : undefined;
        if (topic) {
          try {
            ws = addTrustEdge(ws, userId, targetId, { topic }, { confidence: 0.85, reasons: ["reliable"], now: Date.now() });
          } catch { /* trust edge is best-effort — the stage still advances */ }
        }
      }
      return commitGraph(userId, refreshDerived(ws));
    });
    res.json(view);
  } catch (e) {
    res.status(400).json(asError(e));
  }
});

/** Remove a saved contact. */
app.delete("/api/contacts/:id", async (req, res) => {
  const { userId, meta } = auth(req);
  const targetId = req.params.id;
  try {
    const view = await serialize(() => {
      const ws = workingSet(userId, meta);
      const links = ws.links.filter(
        (l) => !(l.type === "SAVED" && l.userId === userId && endId(l.source) === userId && endId(l.target) === targetId),
      );
      return commitGraph(userId, refreshDerived({ ...ws, links }));
    });
    res.json(view);
  } catch (e) {
    res.status(400).json(asError(e));
  }
});

/** List the viewer's saved contacts with their bookmark label + lifecycle stage. */
app.get("/api/contacts", (req, res) => {
  const { userId } = auth(req);
  const saved = shared.links.filter(
    (l) => l.type === "SAVED" && l.userId === userId && endId(l.source) === userId,
  );
  const byId = new Map(shared.nodes.map((n) => [n.id, n]));
  const items = saved
    .map((l) => ({
      node: byId.get(endId(l.target)),
      label: l.label ?? "interesting",
      labels: l.labels?.length ? l.labels : l.label ? [l.label] : ["interesting"],
      stage: l.stage ?? "interested",
    }))
    .filter((x) => x.node);
  // `nodes` kept for backward compatibility (export, savedIds).
  res.json({ count: items.length, items, nodes: items.map((x) => x.node) });
});

/** Admin: bulk-import entities into an App (pre-load the attendee/startup list).
 *  Body: { rows: [{ entityType, label, properties }] }. Admin-gated at the BFF. */
app.post("/api/admin/summit/import", async (req, res) => {
  const { userId, meta } = auth(req);
  const rows = (req.body ?? {}).rows;
  if (!Array.isArray(rows)) return res.status(400).json({ error: "rows[] required" });
  try {
    const result = await serialize(async () => {
      let ws = workingSet(userId, meta);
      const base = Date.now();
      const created: { nodeId: string; label: string }[] = [];
      const errors: { label: string; error: string }[] = [];
      rows.forEach((r, i) => {
        try {
          const out = createEntity(ws, {
            entityType: String(r.entityType),
            label: String(r.label ?? ""),
            properties: (r.properties ?? {}) as Record<string, unknown>,
            now: base + i,
          });
          ws = out.dataset;
          created.push({ nodeId: out.nodeId, label: String(r.label ?? "") });
        } catch (e) {
          errors.push({ label: String(r?.label ?? "?"), error: e instanceof Error ? e.message : String(e) });
        }
      });
      await commitGraph(userId, ws);
      return { created: created.length, errors };
    });
    res.json(result);
  } catch (e) {
    res.status(400).json(asError(e));
  }
});

/** Attend / unattend a workshop or session (F7). ATTENDING is a GLOBAL edge —
 *  attendance at a public programme item is public, and shared workshops are a
 *  match signal ("same workshop: …"). */
app.post("/api/attend", async (req, res) => {
  const { userId, meta } = auth(req);
  const workshopId = String((req.body ?? {}).workshopId ?? "");
  const off = Boolean((req.body ?? {}).off);
  try {
    const view = await serialize(() => {
      const ws = workingSet(userId, meta);
      const target = ws.nodes.find((n) => n.id === workshopId);
      if (!target || (target.entityType !== "workshop" && target.entityType !== "session")) {
        throw new Error("not a workshop/session");
      }
      const edgeId = `attend_${userId}_${workshopId}`;
      const links = off
        ? ws.links.filter((l) => l.id !== edgeId)
        : ws.links.some((l) => l.id === edgeId)
          ? ws.links
          : [...ws.links, { id: edgeId, source: userId, target: workshopId, type: "ATTENDING" as const, weight: 1 }];
      return commitGraph(userId, refreshDerived({ ...ws, links }));
    });
    res.json(view);
  } catch (e) {
    res.status(400).json(asError(e));
  }
});

/** The event programme: workshops/sessions with attendee counts + my attendance. */
app.get("/api/programme", (req, res) => {
  const { userId } = auth(req);
  const app_ = appOf(req);
  const counts = new Map<string, number>();
  const mine = new Set<string>();
  for (const l of shared.links) {
    if (l.type !== "ATTENDING") continue;
    const t = endId(l.target);
    counts.set(t, (counts.get(t) ?? 0) + 1);
    if (endId(l.source) === userId) mine.add(t);
  }
  const items = shared.nodes
    .filter((n) => (n.entityType === "workshop" || n.entityType === "session") && appForEntityType(n.entityType!) === app_)
    .map((n) => ({ node: n, attendees: counts.get(n.id) ?? 0, attending: mine.has(n.id) }));
  res.json({ items });
});

/* --------------------------- meeting notes -------------------------- */

const slugTag = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

/** Edge type a confirmed note entity materializes as (from the target person). */
const NOTE_KIND_EDGE: Record<string, "USES" | "NEEDS" | "INTERESTED_IN"> = {
  technology: "USES",
  need: "NEEDS",
  api: "NEEDS",
  skill: "NEEDS",
  market: "INTERESTED_IN",
  country: "INTERESTED_IN",
  idea: "INTERESTED_IN",
  concept: "INTERESTED_IN",
  startup: "INTERESTED_IN",
  organization: "INTERESTED_IN",
  investor: "INTERESTED_IN",
  mentor: "INTERESTED_IN",
};

const STAGE_ORDER = LIFECYCLE_STAGES as readonly string[];

/**
 * Recompute the author's note-derived edges for one target from ALL their
 * remaining notes about that target (diffed like materializeTags, so editing or
 * deleting one note never orphans another's edges). Per entity:
 *   • attendee linking — a name matching a real non-person event entity
 *     (startup/org/workshop/…) targets THAT node instead of a concept;
 *   • otherwise a shared `cn_t_<slug>` concept (minted on demand);
 *   • edge scope follows the widest visibility asserting it (public → global).
 * Persons are never auto-linked (no third-party hearsay edges).
 */
function rebuildNoteEdges(
  ws: Dataset,
  authorId: string,
  targetId: string,
  notes: MeetingNote[],
): Dataset {
  interface Want { edge: "USES" | "NEEDS" | "INTERESTED_IN"; nodeId: string; label: string; isConcept: boolean; pub: boolean }
  const desired = new Map<string, Want>();
  const labelIndex = new Map(
    ws.nodes
      .filter((n) => n.entityType && n.type !== "person" && appForEntityType(n.entityType) !== BUILTIN_APP)
      .map((n) => [n.label.trim().toLowerCase(), n.id]),
  );

  for (const note of notes) {
    const pub = note.visibility === "public";
    for (const e of note.extraction?.entities ?? []) {
      const kind = String(e?.kind ?? "concept");
      const name = String(e?.name ?? "").trim();
      // Admin-defined custom kinds default to INTERESTED_IN; persons never link.
      const edge = kind === "person" ? undefined : (NOTE_KIND_EDGE[kind] ?? "INTERESTED_IN");
      if (!name || !edge) continue;
      const linked = labelIndex.get(name.toLowerCase());
      const slug = slugTag(name);
      if (!linked && !slug) continue;
      const nodeId = linked ?? `cn_t_${slug}`;
      const id = `note_${authorId}_${targetId}_${edge}_${linked ?? slug}`;
      const prev = desired.get(id);
      desired.set(id, { edge, nodeId, label: name, isConcept: !linked, pub: pub || !!prev?.pub });
    }
  }

  const prefix = `note_${authorId}_${targetId}_`;
  const nodes = [...ws.nodes];
  const byId = new Set(nodes.map((n) => n.id));
  for (const [, w] of desired) {
    if (w.isConcept && !byId.has(w.nodeId)) {
      byId.add(w.nodeId);
      nodes.push({ id: w.nodeId, type: "concept", label: w.label, sub: "shared at the event", clusters: [], val: 3 });
    }
  }

  // Entity-to-entity RELATIONS ("fintech startup —needs→ payments API") become
  // labeled RELATES_TO edges between the note's nodes; the note's target person
  // resolves by their own name too ("Ana needs funding" → the person node).
  const targetNode = ws.nodes.find((n) => n.id === targetId);
  const resolveName = (name: string): string | undefined => {
    const key = name.trim().toLowerCase();
    if (!key) return undefined;
    if (targetNode && targetNode.label.trim().toLowerCase() === key) return targetId;
    for (const [, w] of desired) if (w.label.trim().toLowerCase() === key) return w.nodeId;
    return labelIndex.get(key);
  };
  interface WantRel { a: string; b: string; label: string; pub: boolean }
  const desiredRels = new Map<string, WantRel>();
  for (const note of notes) {
    const pub = note.visibility === "public";
    for (const rel of note.extraction?.relations ?? []) {
      const a = resolveName(String(rel?.source ?? ""));
      const b = resolveName(String(rel?.target ?? ""));
      const label = String(rel?.label ?? "").trim().slice(0, 40);
      if (!a || !b || a === b || !label) continue;
      const id = `note_${authorId}_${targetId}_REL_${a}__${b}`;
      const prev = desiredRels.get(id);
      desiredRels.set(id, { a, b, label, pub: pub || !!prev?.pub });
    }
  }

  // Replace the whole prefixed set (scope/visibility may have changed).
  const links: GLink[] = ws.links.filter((l) => !l.id.startsWith(prefix));
  for (const [id, w] of desired) {
    links.push({
      id, source: targetId, target: w.nodeId, type: w.edge, weight: 1,
      ...(w.pub ? {} : { scope: "user" as const, userId: authorId }),
    });
  }
  for (const [id, r] of desiredRels) {
    links.push({
      id, source: r.a, target: r.b, type: "RELATES_TO", weight: 1, label: r.label,
      ...(r.pub ? {} : { scope: "user" as const, userId: authorId }),
    });
  }

  // Prune tag-concepts nothing references anymore.
  const referenced = new Set(links.flatMap((l) => [typeof l.source === "string" ? l.source : l.source.id, typeof l.target === "string" ? l.target : l.target.id]));
  const pruned = nodes.filter((n) => !n.id.startsWith("cn_t_") || referenced.has(n.id));
  return { ...ws, nodes: pruned, links };
}

/**
 * Save a meeting note (F5). Text lives in Postgres with a visibility
 * (private | connections | public); confirmed entities become graph edges via
 * rebuildNoteEdges. Also drops a MET_AT edge and nudges the lifecycle.
 */
app.post("/api/notes", async (req, res) => {
  const { userId, meta } = auth(req);
  const body = req.body ?? {};
  const targetId = String(body.targetId ?? "");
  const text = String(body.text ?? "").trim();
  const entities = Array.isArray(body.entities) ? body.entities : [];
  const relations = Array.isArray(body.relations) ? body.relations : [];
  const photos = Array.isArray(body.photos) ? body.photos.map(String) : undefined;
  const visibility = normalizeVisibility(body.visibility);
  if (!targetId || !text) return res.status(400).json({ error: "targetId and text required" });
  try {
    if (!notesEnabled()) return res.status(503).json({ error: "meeting notes disabled (no DATABASE_URL)" });
    const note = await createNote({ authorId: userId, targetId, text, extraction: { entities, relations }, visibility, photos });
    const all = await notesForPair(userId, targetId);

    const view = await serialize(() => {
      let ws = workingSet(userId, meta);
      if (!ws.nodes.some((n) => n.id === targetId)) throw new Error("unknown target");
      let links = [...ws.links];
      const hasLink = (id: string) => links.some((l) => l.id === id);

      // The meeting moment — a user-scoped MET_AT edge.
      const metId = `met_${userId}_${targetId}`;
      if (!hasLink(metId)) {
        links.push({ id: metId, source: userId, target: targetId, type: "MET_AT", scope: "user", userId, weight: 1 });
      }

      // Bookmark if not already saved; nudge the lifecycle to "conversation".
      const savedId = `saved_${userId}_${targetId}`;
      const savedEdge = links.find((l) => l.id === savedId);
      if (!savedEdge) {
        links.push({ id: savedId, source: userId, target: targetId, type: "SAVED", scope: "user", userId, weight: 1, label: "need_follow_up", stage: "conversation" });
      } else if (STAGE_ORDER.indexOf(savedEdge.stage ?? "interested") < STAGE_ORDER.indexOf("conversation")) {
        links = links.map((l) => (l.id === savedId ? { ...l, stage: "conversation" } : l));
      }

      const next = rebuildNoteEdges({ ...ws, links }, userId, targetId, all);
      return commitGraph(userId, refreshDerived(next));
    });
    res.json({ ...view, _note: { id: note.id, entities: entities.length, visibility: note.visibility } });
  } catch (e) {
    res.status(400).json(asError(e));
  }
});

/** Edit a note (author-only): text, confirmed entities, visibility. */
app.put("/api/notes/:id", async (req, res) => {
  const { userId, meta } = auth(req);
  const body = req.body ?? {};
  try {
    if (!notesEnabled()) return res.status(503).json({ error: "meeting notes disabled" });
    const updated = await updateNote(req.params.id, userId, {
      text: typeof body.text === "string" && body.text.trim() ? body.text.trim() : undefined,
      extraction: Array.isArray(body.entities)
        ? { entities: body.entities, relations: Array.isArray(body.relations) ? body.relations : [] }
        : undefined,
      visibility: body.visibility ? normalizeVisibility(body.visibility) : undefined,
      photos: Array.isArray(body.photos) ? body.photos.map(String) : undefined,
    });
    if (!updated) return res.status(404).json({ error: "not your note" });
    const all = await notesForPair(userId, updated.targetId);
    const view = await serialize(() =>
      commitGraph(userId, refreshDerived(rebuildNoteEdges(workingSet(userId, meta), userId, updated.targetId, all))),
    );
    res.json({ ...view, _note: updated });
  } catch (e) {
    res.status(400).json(asError(e));
  }
});

/** Delete a note (author-only) — its unique edges are rebuilt away. */
app.delete("/api/notes/:id", async (req, res) => {
  const { userId, meta } = auth(req);
  try {
    if (!notesEnabled()) return res.status(503).json({ error: "meeting notes disabled" });
    const gone = await deleteNote(req.params.id, userId);
    if (!gone) return res.status(404).json({ error: "not your note" });
    const all = await notesForPair(userId, gone.targetId);
    const view = await serialize(() =>
      commitGraph(userId, refreshDerived(rebuildNoteEdges(workingSet(userId, meta), userId, gone.targetId, all))),
    );
    res.json({ ...view, _deleted: gone.id });
  } catch (e) {
    res.status(400).json(asError(e));
  }
});

/** The viewer's notes journal (all their notes, hydrated with target labels). */
app.get("/api/notes/mine", async (req, res) => {
  const { userId } = auth(req);
  const notes = await notesByAuthor(userId);
  const byId = new Map(shared.nodes.map((n) => [n.id, n]));
  res.json({
    notes: notes.map((n) => ({ ...n, targetLabel: byId.get(n.targetId)?.label ?? n.targetId })),
  });
});

/** Everyone a viewer knows through the connection edges (any direction). */
function connectionsOf(userId: string): Set<string> {
  const out = new Set<string>();
  for (const l of shared.links) {
    if (l.type !== "FRIENDS_WITH" && l.type !== "SAVED" && l.type !== "MET_AT" && l.type !== "TRUSTS") continue;
    const s = endId(l.source), t = endId(l.target);
    if (s === userId) out.add(t);
    else if (t === userId) out.add(s);
  }
  return out;
}

/** Community notes about a person — audience-filtered server-side:
 *  public → everyone · connections → the AUTHOR's connections · own → always. */
app.get("/api/notes/about/:targetId", async (req, res) => {
  const { userId } = auth(req);
  const all = await notesAbout(req.params.targetId);
  const byId = new Map(shared.nodes.map((n) => [n.id, n]));
  const connectionCache = new Map<string, Set<string>>();
  const visible = all.filter((n) => {
    if (n.authorId === userId) return true;
    if (n.visibility === "public") return true;
    if (n.visibility !== "connections") return false;
    let conns = connectionCache.get(n.authorId);
    if (!conns) {
      conns = connectionsOf(n.authorId);
      connectionCache.set(n.authorId, conns);
    }
    return conns.has(userId);
  });
  res.json({
    notes: visible.map((n) => ({
      ...n,
      authorLabel: byId.get(n.authorId)?.label ?? "Attendee",
      mine: n.authorId === userId,
    })),
  });
});

/** Meeting history with one person: my private notes + our meetings. */
app.get("/api/contacts/:id/history", async (req, res) => {
  const { userId } = auth(req);
  const targetId = req.params.id;
  const [notes, { incoming, outgoing }] = await Promise.all([notesForPair(userId, targetId), myMeetings(userId)]);
  const meetings = [...incoming, ...outgoing].filter(
    (m) => m.requesterId === targetId || m.targetId === targetId,
  );
  res.json({ notes, meetings });
});

/* ------------------------- event locations ------------------------- */

/** Predefined meeting venues for an App (any authed user reads; admin writes). */
app.get("/api/locations", async (req, res) => {
  auth(req);
  res.json({ locations: await listLocations(appOf(req)), enabled: locationsEnabled() });
});

/** Admin: add/update a venue. Gated at the BFF (proxyGraphAdmin). */
app.post("/api/admin/locations", async (req, res) => {
  auth(req);
  const { app: appSlug, label, ord } = req.body ?? {};
  try {
    if (!locationsEnabled()) return res.status(503).json({ error: "event locations disabled (no DATABASE_URL)" });
    res.json(await upsertLocation({ app: String(appSlug ?? "summit"), label: String(label ?? ""), ord }));
  } catch (e) {
    res.status(400).json(asError(e));
  }
});

/** Admin: remove a venue. */
app.delete("/api/admin/locations/:id", async (req, res) => {
  auth(req);
  try {
    await deleteLocation(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json(asError(e));
  }
});

/* ----------------------------- meetings ---------------------------- */

const nodeLabel = (id: string): string => shared.nodes.find((n) => n.id === id)?.label ?? id;
const hydrateMeeting = (m: { requesterId: string; targetId: string } & Record<string, unknown>) => ({
  ...m,
  requesterLabel: nodeLabel(m.requesterId),
  targetLabel: nodeLabel(m.targetId),
});

/** Request a 1:1 (mentor session / investor meeting / coffee) at a time + place. */
app.post("/api/meetings", async (req, res) => {
  const { userId } = auth(req);
  const { targetId, kind, slot, location, note } = req.body ?? {};
  try {
    if (!meetingsEnabled()) return res.status(503).json({ error: "meetings disabled (no DATABASE_URL)" });
    const m = await createMeeting({
      requesterId: userId,
      targetId: String(targetId ?? ""),
      kind,
      slot: slot ? String(slot) : undefined,
      location: location ? String(location).slice(0, 120) : undefined,
      note,
    });
    res.json(hydrateMeeting(m));
  } catch (e) {
    res.status(400).json(asError(e));
  }
});

/** The viewer's meetings (incoming requests + outgoing), hydrated with names. */
app.get("/api/meetings", async (req, res) => {
  const { userId } = auth(req);
  const { incoming, outgoing } = await myMeetings(userId);
  res.json({ incoming: incoming.map(hydrateMeeting), outgoing: outgoing.map(hydrateMeeting) });
});

/** Confirm / decline a meeting (target only). */
app.post("/api/meetings/:id/:action", async (req, res) => {
  const { userId } = auth(req);
  const action = req.params.action === "confirm" ? "confirmed" : req.params.action === "decline" ? "declined" : null;
  if (!action) return res.status(400).json({ error: "action must be confirm|decline" });
  try {
    const m = await respondMeeting(req.params.id, userId, action);
    if (!m) return res.status(404).json({ error: "not found or not yours to respond to" });
    res.json(hydrateMeeting(m));
  } catch (e) {
    res.status(400).json(asError(e));
  }
});

/* ------------------------------ trust ------------------------------ */
/* Directed, topic-scoped trust + runtime trust-ranked search (Doc §2–9). */

/** Create/update a trust edge: the viewer trusts `to` on a topic scope. */
app.post("/api/trust", async (req, res) => {
  const { userId, meta } = auth(req);
  const { to, scope, reasons, confidence, evidence, note } = req.body ?? {};
  void recordInteraction({
    userId,
    nodeId: String(to),
    kind: "trust",
    topic: (scope as TrustScope)?.topic,
  });
  try {
    res.json(
      await serialize(() =>
        commitGraph(
          userId,
          addTrustEdge(workingSet(userId, meta), userId, String(to), scope as TrustScope, {
            confidence: typeof confidence === "number" ? confidence : undefined,
            reasons: Array.isArray(reasons) ? reasons.map(String) : undefined,
            source: "explicit",
            evidence: Array.isArray(evidence) ? evidence.map(String) : undefined,
            note: typeof note === "string" ? note : undefined,
            now: Date.now(),
          }),
        ),
      ),
    );
  } catch (e) {
    res.status(400).json(asError(e));
  }
});

app.delete("/api/trust", async (req, res) => {
  const { userId, meta } = auth(req);
  const { linkId } = req.body ?? {};
  try {
    res.json(
      await serialize(() =>
        commitGraph(userId, removeTrustEdge(workingSet(userId, meta), userId, String(linkId))),
      ),
    );
  } catch (e) {
    res.status(400).json(asError(e));
  }
});

/** The viewer's own trust edges. */
app.get("/api/trust", (req, res) => {
  const { userId } = auth(req);
  const mine = shared.links.filter(
    (l: GLink) => l.type === "TRUSTS" && (typeof l.source === "string" ? l.source : l.source.id) === userId,
  );
  res.json(mine);
});

/** Record outcome feedback on a trust edge (👍 → +1, 👎 → -1). */
app.post("/api/trust/outcome", async (req, res) => {
  const { userId, meta } = auth(req);
  const { edgeId, value, kind, recNodeId } = req.body ?? {};
  const v = Math.max(-1, Math.min(1, Number(value ?? 0)));
  try {
    const edge = shared.links.find((l) => l.id === String(edgeId));
    const view = await serialize(() =>
      commitGraph(userId, applyOutcomeToEdge(workingSet(userId, meta), String(edgeId), v, Date.now())),
    );
    if (edge?.trust) {
      await recordOutcome({
        edgeId: String(edgeId),
        fromId: typeof edge.source === "string" ? edge.source : edge.source.id,
        toId: typeof edge.target === "string" ? edge.target : edge.target.id,
        userId,
        recNodeId: recNodeId ? String(recNodeId) : undefined,
        kind: String(kind ?? (v >= 0 ? "positive" : "negative")),
        value: v,
        scope: edge.trust.scope,
      });
    }
    res.json(view);
  } catch (e) {
    res.status(400).json(asError(e));
  }
});

/** Trust-ranked search: resolve a query scope → trust-transferred recommendations. */
app.post("/api/trust-search", async (req, res) => {
  const { userId, meta } = auth(req);
  const { topic, geo, context, lat, lng, radiusKm } = req.body ?? {};
  if (!topic) return res.status(400).json({ error: "topic required" });
  const query: TrustQuery = {
    topic: String(topic),
    geo: geo ? String(geo) : undefined,
    context: context ? String(context) : undefined,
  };
  // Optional "near me": the viewer's coordinates (browser geolocation) let us
  // annotate results with distance and filter by radius. Trust ranking is
  // unchanged — distance is additive display + an optional hard filter.
  const here =
    typeof lat === "number" && typeof lng === "number" ? { lat, lng } : null;
  const radius = typeof radiusKm === "number" && radiusKm > 0 ? radiusKm : null;
  // Semantic expansion (Feature 9): let the query also match trust topics that
  // are embedding-similar (dentist ≈ orthodontist). No-op when embeddings are
  // off — the engine then uses exact/parent matching only.
  if (embeddingsEnabled()) {
    try {
      const edgeTopics = shared.links
        .filter((l) => l.type === "TRUSTS" && l.trust)
        .map((l) => l.trust!.scope.topic);
      const expanded = await similarTopics(query.topic, edgeTopics);
      if (expanded.length) query.expandedTopics = expanded;
    } catch {
      /* fall back to equality matching */
    }
  }
  // Relationship strength (personalization only) modulates how much trust flows
  // across the viewer's own friendships — never creates trust, never touches
  // reputation. Absent ⇒ transfer is identical to the legacy flat-friend model.
  const relationshipStrength = await strengthMap(userId, shared.links);
  const recs = computeTrustRecommendations(shared.nodes, shared.links, userId, query, {
    dismissed: meta.dismissed,
    relationshipStrength,
  });
  // Topic-scoped derived reputation for the queried topic (independent of the
  // viewer's trust path — historical provider reliability only).
  const repIndex = reputationEnabled() ? await reputationIndex(query.topic) : new Map();
  // Attach labels + path context so the UI can render results + the graph
  // animation without a second lookup.
  const labelOf = new Map(shared.nodes.map((n) => [n.id, n.label] as const));
  const linkById = new Map(shared.links.map((l) => [l.id, l] as const));
  const enriched = recs.map((r) => {
    const node = shared.nodes.find((n) => n.id === r.nodeId);
    const hops = r.trustPath?.length ?? 1;
    const lastHop = r.trustPath?.[hops - 1];
    const reasons = lastHop ? (linkById.get(lastHop.edgeId)?.trust?.reasons ?? []) : [];
    // Full labelled path: you → … → target.
    const pathLabels = [
      labelOf.get(userId) ?? "You",
      ...(r.trustPath ?? []).map((h) => labelOf.get(h.to) ?? h.to),
    ];
    const distanceKm =
      here && typeof node?.lat === "number" && typeof node?.lng === "number"
        ? Math.round(haversineKm(here, { lat: node.lat, lng: node.lng }) * 10) / 10
        : undefined;
    const rep = repIndex.get(r.nodeId);
    const reputationReason =
      rep && rep.score > 0.1 && rep.contributors >= 2
        ? `${rep.contributors} independent contributors reported positive outcomes on ${query.topic}`
        : undefined;
    return {
      ...r,
      label: labelOf.get(r.nodeId) ?? r.nodeId,
      nodeType: node?.type,
      sub: node?.sub,
      entityType: node?.entityType,
      properties: node?.properties,
      lat: node?.lat,
      lng: node?.lng,
      distanceKm,
      viaLabels: r.via.map((id) => labelOf.get(id) ?? id),
      hops,
      reasons: reputationReason ? [...reasons, reputationReason] : reasons,
      reputation: rep
        ? { score: rep.score, confidence: rep.confidence, samples: rep.samples, contributors: rep.contributors }
        : null,
      pathLabels,
    };
  })
    // Hard radius filter only applies to results we could locate.
    .filter((r) => !radius || r.distanceKm === undefined || r.distanceKm <= radius);

  // Unified ranking pipeline (Doc #10): layer topic reputation + recommendation
  // quality + context match on top of the trust base, producing an explainable
  // factor breakdown + a stable order. Relationship strength is already applied
  // inside trust transfer (it shaped `score`), so it isn't re-applied here — no
  // double counting. Outcome is likewise already folded into `score`.
  const candidates = enriched.map((e) => {
    const lastHop = e.trustPath?.[(e.trustPath?.length ?? 1) - 1];
    const edge = lastHop ? linkById.get(lastHop.edgeId) : undefined;
    const reasonsCount = edge?.trust?.reasons?.length ?? 0;
    const hasContext = !!edge?.trust?.scope?.context;
    const quality = Math.min(1, 0.3 + 0.15 * reasonsCount + (hasContext ? 0.2 : 0));
    const contextMatch = query.context
      ? edge?.trust?.scope?.context === query.context
        ? 1
        : 0.8
      : 1;
    const rep = e.reputation;
    return {
      nodeId: e.nodeId,
      trustStrength: e.score, // base already includes trust path + relationship + outcome
      reputation: rep ? rep.score * rep.confidence : 0, // effective topic reputation
      outcome: 0, // already in trustStrength
      relationship: 0, // already applied in transfer
      quality,
      contextMatch,
      personalization: 0,
      label: e.label,
    };
  });
  const ranked = rankCandidates(candidates, RANKING_CONFIG);
  const byId = new Map(enriched.map((e) => [e.nodeId, e] as const));
  const ordered = ranked
    .map((rr) => {
      const e = byId.get(rr.nodeId);
      if (!e) return null;
      return {
        ...e,
        rankScore: rr.score,
        factors: rr.factors,
        reasons: [...new Set([...e.reasons, ...rr.reasons])],
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  void recordSearch({
    userId,
    rawQuery: query.topic,
    topic: query.topic,
    geo: query.geo,
    context: query.context,
    expanded: query.expandedTopics,
    resultCount: ordered.length,
    source: "trust-search",
  });
  res.json({ query, recommendations: ordered });
});

/* --------------- first-class recommendation entities (Doc #9/#11) --------------- */
/* Recommendations are immutable graph nodes carrying who/what/why/context/for-whom;
 * Outcomes are independent nodes that accrue as evidence via SUPPORTED_BY. Persisted
 * through the generic :Entity/:REL store — no schema change. */

let recSeq = 0;
const newEntityId = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}${(recSeq++ % 46656).toString(36)}`;

/** Publish an immutable recommendation. Author = the viewer. */
app.post("/api/recs", async (req, res) => {
  const { userId, meta } = auth(req);
  const b = req.body ?? {};
  const targetId = str(b.targetId, 200);
  const topic = str(b.topic, 60)?.toLowerCase();
  if (!targetId || !topic) return res.status(400).json({ error: "targetId and topic required" });
  if (!shared.nodes.some((n) => n.id === targetId))
    return res.status(404).json({ error: "target not found" });
  try {
    const id = newEntityId("rec");
    const reasons = Array.isArray(b.reasons)
      ? (b.reasons as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 10)
      : [];
    await serialize(() =>
      commitGraph(
        userId,
        createRecommendation(workingSet(userId, meta), {
          id,
          authorId: userId,
          targetId,
          topic,
          context: str(b.context, 120),
          audience: str(b.audience, 120),
          reasons,
          note: str(b.note, 500),
          createdAt: Date.now(),
        }),
      ),
    );
    res.json({ ok: true, id });
  } catch (e) {
    res.status(400).json(asError(e));
  }
});

/** Attach an outcome to a recommendation (evidence accumulation, never a rewrite). */
app.post("/api/recs/:id/outcomes", async (req, res) => {
  const { userId, meta } = auth(req);
  const recId = String(req.params.id);
  const b = req.body ?? {};
  const value = Math.max(-1, Math.min(1, Number(b.value)));
  if (!Number.isFinite(Number(b.value))) return res.status(400).json({ error: "value in [-1,1] required" });
  const rec = shared.nodes.find((n) => n.id === recId && n.type === "recommendation");
  if (!rec) return res.status(404).json({ error: "recommendation not found" });
  try {
    const id = newEntityId("oc");
    await serialize(() =>
      commitGraph(
        userId,
        attachOutcome(workingSet(userId, meta), recId, {
          id,
          contributorId: userId,
          value,
          kind: str(b.kind, 40),
          detail: str(b.detail, 300),
          at: Date.now(),
        }),
      ),
    );
    // Also feed the append-only outcome log so DERIVED reputation reflects it.
    const props = rec.properties as { targetId?: string; topic?: string } | undefined;
    void recordOutcome({
      edgeId: recId,
      fromId: userId,
      toId: props?.targetId,
      userId,
      recNodeId: recId,
      kind: value >= 0 ? "positive" : "negative",
      value,
      scope: props?.topic ? { topic: props.topic } : undefined,
    });
    res.json({ ok: true, id });
  } catch (e) {
    res.status(400).json(asError(e));
  }
});

/** All recommendations pointing at a specialist/provider, with consensus. */
app.get("/api/recs", (req, res) => {
  const { userId } = auth(req);
  const target = String(req.query.target ?? "");
  if (!target) return res.status(400).json({ error: "target query param required" });
  const ds: Dataset = { nodes: shared.nodes, links: shared.links, meId: userId, recommendations: [] };
  const labelOf = new Map(shared.nodes.map((n) => [n.id, n.label] as const));
  const recs = recommendationsForTarget(ds, target).map((n) => {
    const p = (n.properties ?? {}) as Record<string, unknown>;
    return {
      id: n.id,
      author: { id: p.authorId, name: labelOf.get(String(p.authorId)) },
      topic: p.topic,
      context: p.context,
      audience: p.audience,
      reasons: p.reasons,
      note: p.note,
      createdAt: p.createdAt,
      consensus: recommendationConsensus(ds, n.id),
    };
  });
  res.json({ target, recommendations: recs });
});

/** A single recommendation with its accumulated outcome evidence. */
app.get("/api/recs/:id", (req, res) => {
  const { userId } = auth(req);
  const recId = String(req.params.id);
  const rec = shared.nodes.find((n) => n.id === recId && n.type === "recommendation");
  if (!rec) return res.status(404).json({ error: "recommendation not found" });
  const ds: Dataset = { nodes: shared.nodes, links: shared.links, meId: userId, recommendations: [] };
  const outcomes = outcomesForRecommendation(ds, recId).map((o) => o.properties);
  res.json({ id: recId, properties: rec.properties, outcomes, consensus: recommendationConsensus(ds, recId) });
});

/* --------------------- Contribution Engine (#20/#21/#22) --------------------- */
/* Derived, explainable measure of how much this user improved the network.
 * Independent from Trust, Reputation and Relationship Strength; consumed by
 * Listen capacity (and future reward systems), never by ranking or trust. */

/** My contribution: score, stage, per-kind explanations, recent history. */
app.get("/api/contribution", async (req, res) => {
  const { userId } = auth(req);
  const topic = typeof req.query.topic === "string" ? req.query.topic.toLowerCase() : undefined;
  try {
    res.json(await contributionSummaryFor(userId, shared.nodes, { topic }));
  } catch (e) {
    res.status(500).json(asError(e));
  }
});

/** Admin: every user's contribution score — the algorithm monitoring/tuning
 *  view. POST accepts a sanitized config override to SIMULATE a re-tuning
 *  (permanent changes go through the CONTRIB_* env vars). Admin-gated at the
 *  BFF (proxyGraphAdmin). Read-only over the same evidence the engine uses. */
const contributionAdminView = async (req: express.Request, res: express.Response) => {
  auth(req);
  try {
    const override =
      req.method === "POST" ? sanitizeContributionOverride(req.body?.config) : {};
    const accounts = await listAccess();
    const byId = new Map(shared.nodes.map((n) => [n.id, n] as const));
    const rows = await contributionOverview(
      accounts.map((a) => a.userId),
      shared.nodes,
      override,
    );
    const statusOf = new Map(accounts.map((a) => [a.userId, a.status] as const));
    res.json({
      envConfig: CONTRIBUTION_ENV,
      appliedOverride: override,
      listen: {
        baseSlots: LISTEN_CONFIG.baseSlots,
        contributionPerSlot: LISTEN_CONFIG.contributionPerSlot,
        maxSlots: LISTEN_CONFIG.maxSlots,
      },
      users: rows.map((r) => {
        const node = byId.get(r.userId);
        return {
          userId: r.userId,
          name: node?.label,
          email: (node as { sub?: string } | undefined)?.sub,
          accountStatus: statusOf.get(r.userId),
          score: r.score.score,
          stage: r.score.stage,
          events: r.score.events,
          lifetime: r.score.lifetime,
          momentum: r.score.momentum,
          consistency: r.score.consistency,
          diversity: r.score.diversity,
          capacity: listenCapacity(r.score.score, LISTEN_CONFIG),
          factors: r.score.factors,
        };
      }),
    });
  } catch (e) {
    res.status(500).json(asError(e));
  }
};
app.get("/api/admin/contribution", contributionAdminView);
app.post("/api/admin/contribution", contributionAdminView);

/* ------------------------- Listen (Doc #6/#7) ------------------------- */
/* A permission to receive someone's FUTURE recommendations. Directional,
 * acceptance-based, capacity-bounded, EARNED (never bought). It grants
 * eligibility only — never trust, never reputation. The edge is
 * LISTENS_TO_PERSON (the spec's "LISTENS_TO" name is taken by person→music). */

/** This user's EARNED listen capacity (slots). No payment term exists.
 * Three additive sources (#21/#23): contribution (primary, via the engine),
 * membership tenure (slow weekly growth, capped), and temporary credit-bought
 * boosts (which sit ON TOP of the normal ceiling — they're time-boxed). */
async function capacityFor(userId: string): Promise<{
  capacity: number;
  contribution: number;
  breakdown: { base: number; fromContribution: number; fromTenure: number; fromBoosts: number };
}> {
  const contribution = await contributionValueFor(userId, shared.nodes);
  const access = await getAccess(userId);
  const tenureWeeks = access ? Math.max(0, (Date.now() - Date.parse(access.createdAt)) / (7 * 86_400_000)) : 0;
  const boosts = await activeBoostSlots(userId);
  const core = listenCapacity(contribution, LISTEN_CONFIG, tenureWeeks);
  return {
    capacity: core + boosts,
    contribution,
    breakdown: {
      base: LISTEN_CONFIG.baseSlots,
      fromContribution: Math.floor(contribution / Math.max(1, LISTEN_CONFIG.contributionPerSlot)),
      fromTenure:
        LISTEN_CONFIG.weeksPerSlot > 0
          ? Math.min(LISTEN_CONFIG.maxTenureSlots, Math.floor(tenureWeeks / LISTEN_CONFIG.weeksPerSlot))
          : 0,
      fromBoosts: boosts,
    },
  };
}

const listenDataset = (userId: string): Dataset => ({
  nodes: shared.nodes,
  links: shared.links,
  meId: userId,
  recommendations: [],
});

/** My listening state: who I listen to, my audience, slots and earned capacity. */
app.get("/api/listen", async (req, res) => {
  const { userId } = auth(req);
  try {
    const ds = listenDataset(userId);
    const labelOf = new Map(shared.nodes.map((n) => [n.id, n.label] as const));
    const { capacity, contribution, breakdown } = await capacityFor(userId);
    const used = activeListenCount(ds, userId);
    res.json({
      listening: listeningTo(ds, userId).map((id) => ({ id, name: labelOf.get(id) })),
      listeners: listenersOf(ds, userId).map((id) => ({ id, name: labelOf.get(id) })),
      slots: { used, capacity, remaining: Math.max(0, capacity - used), breakdown },
      contribution,
      policy: await getPolicy(userId),
      config: {
        baseSlots: LISTEN_CONFIG.baseSlots,
        contributionPerSlot: LISTEN_CONFIG.contributionPerSlot,
        maxSlots: LISTEN_CONFIG.maxSlots,
        weeksPerSlot: LISTEN_CONFIG.weeksPerSlot,
        maxTenureSlots: LISTEN_CONFIG.maxTenureSlots,
      },
    });
  } catch (e) {
    res.status(500).json(asError(e));
  }
});

/** Who to listen to — explainable suggestions for free capacity (#23).
 *  Signals: topic overlap, trust-of-trust, contribution quality, relationship
 *  strength. Never popularity, never follower counts. */
app.get("/api/listen/suggestions", async (req, res) => {
  const { userId } = auth(req);
  try {
    const ds = listenDataset(userId);
    // Cheap pass (graph signals only) to shortlist, then hydrate the two
    // service-side signals (contribution, relationship strength) and re-rank.
    const shortlist = listenSuggestions(ds, userId, { limit: 25 });
    const contributionOf = new Map<string, number>();
    for (const s of shortlist)
      contributionOf.set(s.personId, await contributionValueFor(s.personId, shared.nodes));
    const strength = await strengthMap(userId, shared.links);
    const ranked = listenSuggestions(ds, userId, {
      contributionOf: (id) => contributionOf.get(id) ?? 0,
      strengthOf: (id) => strength.get(id) ?? 0,
      limit: Math.min(20, Math.max(1, Number(req.query.limit ?? 8) || 8)),
    });
    const labelOf = new Map(shared.nodes.map((n) => [n.id, n.label] as const));
    res.json({
      suggestions: ranked.map((s) => ({
        id: s.personId,
        name: labelOf.get(s.personId),
        score: s.score,
        reasons: s.reasons,
      })),
    });
  } catch (e) {
    res.status(500).json(asError(e));
  }
});

/** Set my permission policy (manual | auto_accept) — pluggable for future policies. */
app.post("/api/listen/policy", async (req, res) => {
  const { userId } = auth(req);
  const policy = String(req.body?.policy ?? "");
  if (policy !== "manual" && policy !== "auto_accept")
    return res.status(400).json({ error: "policy must be manual | auto_accept" });
  try {
    await setPolicy(userId, policy as ListenPolicy);
    res.json({ ok: true, policy });
  } catch (e) {
    res.status(500).json(asError(e));
  }
});

/** Request to listen to someone. Auto-accepted if their policy says so. */
app.post("/api/listen/requests", async (req, res) => {
  const { userId, meta } = auth(req);
  if (!listenEnabled()) return res.status(503).json({ error: "listen unavailable" });
  const targetId = str(req.body?.targetId, 200);
  if (!targetId) return res.status(400).json({ error: "targetId required" });
  if (targetId === userId) return res.status(400).json({ error: "cannot listen to yourself" });
  const target = shared.nodes.find((n) => n.id === targetId && n.type === "person");
  if (!target) return res.status(404).json({ error: "person not found" });
  try {
    const ds = listenDataset(userId);
    if (isListening(ds, userId, targetId))
      return res.json({ ok: true, status: "already_listening" });

    // Guard the slot budget up-front so we never queue a request we can't honour.
    const { capacity } = await capacityFor(userId);
    if (activeListenCount(ds, userId) >= capacity)
      return res.status(409).json({ error: "listen capacity reached", capacity });

    const request = await createRequest(userId, targetId);
    if ((await getPolicy(targetId)) === "auto_accept") {
      await serialize(() =>
        commitGraph(userId, addListenEdge(workingSet(userId, meta), userId, targetId, capacity)),
      );
      await markAccepted(request.id);
      return res.json({ ok: true, status: "accepted", requestId: request.id });
    }
    res.json({ ok: true, status: "pending", requestId: request.id, expiresAt: request.expiresAt });
  } catch (e) {
    res.status(400).json(asError(e));
  }
});

/** Requests awaiting my decision + the ones I've sent. */
app.get("/api/listen/requests", async (req, res) => {
  const { userId } = auth(req);
  try {
    const labelOf = new Map(shared.nodes.map((n) => [n.id, n.label] as const));
    const [incoming, outgoing] = await Promise.all([incomingRequests(userId), outgoingRequests(userId)]);
    res.json({
      incoming: incoming.map((r) => ({ ...r, requesterName: labelOf.get(r.requesterId) })),
      outgoing: outgoing.map((r) => ({ ...r, targetName: labelOf.get(r.targetId) })),
    });
  } catch (e) {
    res.status(500).json(asError(e));
  }
});

/**
 * Accept a listen request — ONLY the target may accept, and this is the one place
 * the LISTENS_TO_PERSON edge is created. Acceptance is NOT reciprocal.
 */
app.post("/api/listen/requests/:id/accept", async (req, res) => {
  const { userId, meta } = auth(req);
  const id = Number(req.params.id);
  try {
    const request = await getRequest(id);
    if (!request) return res.status(404).json({ error: "request not found" });
    if (request.targetId !== userId) return res.status(403).json({ error: "not your request to accept" });

    // The REQUESTER is the listener — their slot budget applies, re-checked now.
    const { capacity } = await capacityFor(request.requesterId);
    const resolved = await resolveRequest(id, userId, "accepted");
    if (!resolved) return res.status(409).json({ error: "request is no longer pending (or expired)" });

    await serialize(() =>
      commitGraph(
        userId,
        addListenEdge(workingSet(userId, meta), request.requesterId, request.targetId, capacity),
      ),
    );
    res.json({ ok: true, status: "accepted" });
  } catch (e) {
    res.status(400).json(asError(e));
  }
});

/** Decline a listen request. No edge, no trace beyond the request record. */
app.post("/api/listen/requests/:id/decline", async (req, res) => {
  const { userId } = auth(req);
  try {
    const resolved = await resolveRequest(Number(req.params.id), userId, "declined");
    if (!resolved) return res.status(409).json({ error: "request is no longer pending (or not yours)" });
    res.json({ ok: true, status: "declined" });
  } catch (e) {
    res.status(400).json(asError(e));
  }
});

/** Stop listening — frees the slot immediately. */
app.delete("/api/listen/:targetId", async (req, res) => {
  const { userId, meta } = auth(req);
  const targetId = String(req.params.targetId);
  try {
    await serialize(() =>
      commitGraph(userId, removeListenEdge(workingSet(userId, meta), userId, targetId)),
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json(asError(e));
  }
});

/**
 * The payoff: recommendations authored by the people I listen to become ELIGIBLE.
 * Ranked by EVIDENCE only (quality + topic reputation + outcome consensus) — the
 * base here is *eligibility*, NOT trust. Listening makes knowledge visible; it
 * never makes it trusted, and no trust score is computed or returned.
 */
app.get("/api/listen/feed", async (req, res) => {
  const { userId } = auth(req);
  const topic = str(req.query.topic as unknown, 60)?.toLowerCase();
  try {
    const ds = listenDataset(userId);
    const eligible = recommendationsFromListened(ds, userId, topic);
    if (eligible.length === 0) return res.json({ recommendations: [] });

    const labelOf = new Map(shared.nodes.map((n) => [n.id, n.label] as const));
    const repIndex = topic && reputationEnabled() ? await reputationIndex(topic) : new Map();

    const candidates = eligible.map((n) => {
      const p = (n.properties ?? {}) as Record<string, unknown>;
      const consensus = recommendationConsensus(ds, n.id);
      const reasonsCount = Array.isArray(p.reasons) ? (p.reasons as unknown[]).length : 0;
      const quality = Math.min(1, 0.3 + 0.15 * reasonsCount + (p.context ? 0.2 : 0));
      const rep = repIndex.get(String(p.targetId));
      return {
        nodeId: n.id,
        trustStrength: 1, // eligibility base — NOT a trust score
        reputation: rep ? rep.score * rep.confidence : 0,
        outcome: consensus.mean,
        quality,
        contextMatch: 1,
        relationship: 0,
        personalization: 0,
      };
    });
    // baseStage "eligibility", NOT "trust" — nothing here is trusted, it is merely
    // audible to me because I chose to listen. Reporting a "trust" factor on this
    // surface would contradict the frozen Listen guarantee.
    const ranked = rankCandidates(candidates, { ...RANKING_CONFIG, baseStage: "eligibility" });
    const byId = new Map(eligible.map((n) => [n.id, n] as const));

    res.json({
      recommendations: ranked
        .map((r) => {
          const n = byId.get(r.nodeId);
          if (!n) return null;
          const p = (n.properties ?? {}) as Record<string, unknown>;
          return {
            id: n.id,
            author: { id: p.authorId, name: labelOf.get(String(p.authorId)) },
            target: { id: p.targetId, name: labelOf.get(String(p.targetId)) },
            topic: p.topic,
            context: p.context,
            audience: p.audience,
            reasons: p.reasons,
            consensus: recommendationConsensus(ds, n.id),
            score: r.score,
            factors: r.factors,
            why: r.reasons.length
              ? r.reasons
              : [`${labelOf.get(String(p.authorId)) ?? "Someone"} — whom you listen to — recommended this`],
          };
        })
        .filter(Boolean),
    });
  } catch (e) {
    res.status(500).json(asError(e));
  }
});

/* ------------------------------ credits (#23) ---------------------------- */
/* Controlled access to platform capabilities. NOT currency, NOT trust, NOT
 * contribution — structurally isolated from trust/ranking. Earned credits are
 * DERIVED from validated Contribution; grants/spends live in an append-only
 * ledger. V1 consumer: a temporary Listen-capacity boost. */

/** My credit balance, sources, and spend options. */
app.get("/api/credits", async (req, res) => {
  const { userId } = auth(req);
  try {
    const contribution = await contributionValueFor(userId, shared.nodes);
    const earned = earnedCredits(contribution);
    const ledger = await ledgerSum(userId);
    res.json({
      balance: Math.max(0, earned + ledger),
      earned,
      ledger,
      history: await creditHistory(userId),
      config: {
        pointsPerCredit: CREDITS_CONFIG.pointsPerCredit,
        boost: {
          cost: CREDITS_CONFIG.boostCost,
          days: CREDITS_CONFIG.boostDays,
          slots: CREDITS_CONFIG.boostSlots,
          maxActive: CREDITS_CONFIG.maxActiveBoosts,
        },
      },
    });
  } catch (e) {
    res.status(500).json(asError(e));
  }
});

/** Spend credits on a temporary Listen-capacity boost (atomic guard). */
app.post("/api/credits/boost", async (req, res) => {
  const { userId } = auth(req);
  try {
    const contribution = await contributionValueFor(userId, shared.nodes);
    const result = await spendForBoost(userId, earnedCredits(contribution));
    if (!result.ok) {
      const msg =
        result.reason === "insufficient_credits"
          ? "Not enough credits — earn more by improving the network."
          : result.reason === "boost_limit"
            ? "Boost limit reached — wait for an active boost to expire."
            : "Credits are unavailable.";
      return res.status(400).json({ error: msg, reason: result.reason });
    }
    const { capacity, breakdown } = await capacityFor(userId);
    res.json({ ok: true, expiresAt: result.expiresAt, capacity, breakdown });
  } catch (e) {
    res.status(500).json(asError(e));
  }
});

/** Admin: grant credits (auditable — records who and why). BFF-gated. */
app.post("/api/admin/credits/:userId", async (req, res) => {
  const { userId: adminId } = auth(req);
  const target = String(req.params.userId);
  const amount = Number(req.body?.amount);
  if (!Number.isFinite(amount) || amount < 1)
    return res.status(400).json({ error: "amount >= 1 required" });
  try {
    await grantCredits(target, amount, adminId, str(req.body?.note, 200));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json(asError(e));
  }
});

/* ------------------------------ invites ---------------------------- */
/* Shareable friend-invite links + the conversion funnel (Phase 2).     */

/** Create a new invite link owned by the viewer. */
app.post("/api/invites", async (req, res) => {
  const { userId } = auth(req);
  if (!invitesEnabled()) return res.status(503).json({ error: "invites unavailable" });
  const note = typeof req.body?.note === "string" ? req.body.note.slice(0, 200) : undefined;
  const maxUses =
    typeof req.body?.maxUses === "number" ? req.body.maxUses : INVITE_DEFAULT_MAX_USES;
  try {
    const invite = await createInvite(userId, note, maxUses);
    res.json({ code: invite.code, path: `/invite/${invite.code}`, maxUses: invite.maxUses });
  } catch (e) {
    res.status(500).json(asError(e));
  }
});

/** The viewer's invites with per-link funnel + headline conversion stats. */
app.get("/api/invites", async (req, res) => {
  const { userId } = auth(req);
  try {
    const [invites, stats] = await Promise.all([listInvitesFor(userId), inviteStats(userId)]);
    const labelOf = new Map(shared.nodes.map((n) => [n.id, n.label] as const));
    const enriched = invites.map((i) => ({
      ...i,
      joinedNames: i.joinedIds.map((id) => labelOf.get(id) ?? "Someone"),
    }));
    res.json({ invites: enriched, stats });
  } catch (e) {
    res.status(500).json(asError(e));
  }
});

/**
 * Accept an invite: validate + consume it (quota-enforced) and grant the user
 * `pending_onboarding` access, binding their registration origin. Called
 * server-side by the BFF callback once the new user's session exists.
 *
 * NOTE: this deliberately creates NO graph edge. The inviter connection is a
 * distinct `INVITED` edge created only after onboarding completes (spec: "graph
 * relationships should not be created until onboarding has been completed").
 */
app.post("/api/invites/accept", async (req, res) => {
  const { userId } = auth(req);
  const code = String(req.body?.code ?? "");
  try {
    const invite = await getInvite(code);
    if (!invite || invite.revoked) return res.json({ ok: false, reason: "invalid" });
    if (invite.inviterId === userId) return res.json({ ok: false, reason: "self" });
    if (!shared.nodes.some((n) => n.id === invite.inviterId))
      return res.json({ ok: false, reason: "inviter_gone" });

    const result = await consumeInvite(code, userId);
    if (!result.ok) return res.json({ ok: false, reason: result.reason });
    await bindInvite(userId, code, invite.inviterId);
    const inviter = shared.nodes.find((n) => n.id === invite.inviterId);
    res.json({
      ok: true,
      inviter: { id: invite.inviterId, name: inviter?.label ?? "A friend" },
      newConnection: result.firstTime,
    });
  } catch (e) {
    res.status(400).json(asError(e));
  }
});

/* --------------------- access / waitlist / onboarding -------------------- */

/** The viewer's front-door state: account status + config + referral progress.
 * Admins are exempt from the front door: the BFF verifies the admin role (JWT
 * signature) and forwards `x-user-admin: 1`; we auto-activate so an admin never
 * sits on the waitlist or gets bounced into onboarding. */
app.get("/api/access", async (req, res) => {
  const { userId } = auth(req);
  try {
    let access = await getAccess(userId);
    if (req.header("x-user-admin") === "1" && access && access.status !== "active") {
      await setStatus(userId, "active");
      access = await getAccess(userId);
    }
    const status = access?.status ?? (accessEnabled() ? "waitlisted" : "active");
    const waitlist = status === "waitlisted" ? await getWaitlistByUser(userId) : null;
    const onboarding = await getOnboarding(userId);
    res.json({
      status,
      onboardingComplete: onboarding.completed,
      inviterId: access?.inviterId,
      config: {
        inviteDefaultMaxUses: INVITE_DEFAULT_MAX_USES,
        waitlistUnlockThreshold: WAITLIST_UNLOCK_THRESHOLD,
      },
      waitlist: waitlist
        ? {
            code: waitlist.code,
            referralPath: `/invite/${waitlist.code}`,
            referredCount: waitlist.referredCount,
            threshold: waitlist.threshold,
            unlocked: waitlist.unlocked,
          }
        : undefined,
    });
  } catch (e) {
    res.status(500).json(asError(e));
  }
});

/** Join the waitlist: mint a personal referral link and record the entry. */
app.post("/api/waitlist/join", async (req, res) => {
  const { userId } = auth(req);
  if (!waitlistEnabled() || !invitesEnabled())
    return res.status(503).json({ error: "waitlist unavailable" });
  const email = typeof req.body?.email === "string" ? req.body.email.slice(0, 200) : undefined;
  try {
    const existing = await getWaitlistByUser(userId);
    // Referral link = an invite whose inviter is this user; generous quota so the
    // referral drive isn't capped below the unlock threshold.
    const code =
      existing?.code ??
      (await createInvite(userId, "waitlist referral", Math.max(INVITE_DEFAULT_MAX_USES, WAITLIST_UNLOCK_THRESHOLD * 4))).code;
    const entry = await joinWaitlist(userId, code, email);
    await bindWaitlist(userId, entry.code);
    res.json({
      ok: true,
      code: entry.code,
      referralPath: `/invite/${entry.code}`,
      referredCount: entry.referredCount,
      threshold: entry.threshold,
      unlocked: entry.unlocked,
    });
  } catch (e) {
    // Unique-violation on the email index → friendly 409, no DB internals leaked.
    if ((e as { code?: string })?.code === "23505") {
      return res.status(409).json({ error: "That email is already on the waitlist." });
    }
    res.status(500).json(asError(e));
  }
});

/** Waitlist progress for the viewer. */
app.get("/api/waitlist/status", async (req, res) => {
  const { userId } = auth(req);
  try {
    const entry = await getWaitlistByUser(userId);
    if (!entry) return res.json({ ok: false });
    res.json({
      ok: true,
      code: entry.code,
      referralPath: `/invite/${entry.code}`,
      referredCount: entry.referredCount,
      threshold: entry.threshold,
      unlocked: entry.unlocked,
    });
  } catch (e) {
    res.status(500).json(asError(e));
  }
});

/** Admin: everyone currently held at the front door, with referral progress.
 *  Admin-gated at the BFF (proxyGraphAdmin). */
app.get("/api/admin/waitlist", async (req, res) => {
  auth(req);
  try {
    const held = await listAccess("waitlisted");
    const entries = new Map((await listWaitlist()).map((w) => [w.userId, w] as const));
    const byId = new Map(shared.nodes.map((n) => [n.id, n] as const));
    res.json({
      threshold: WAITLIST_UNLOCK_THRESHOLD,
      users: held.map((a) => {
        const w = entries.get(a.userId);
        const node = byId.get(a.userId);
        return {
          userId: a.userId,
          name: node?.label,
          email: w?.email ?? (node as { sub?: string } | undefined)?.sub,
          waitingSince: a.createdAt,
          joinedWaitlist: !!w,
          referredCount: w?.referredCount ?? 0,
          threshold: WAITLIST_UNLOCK_THRESHOLD,
        };
      }),
    });
  } catch (e) {
    res.status(500).json(asError(e));
  }
});

/** Admin: wave a user through the front door (spec #3/#27 "administrative
 *  approval"). Grants onboarding access — no trust, no graph edge, exactly like
 *  a referral unlock. Admin-gated at the BFF. */
app.post("/api/admin/waitlist/:userId/approve", async (req, res) => {
  auth(req);
  const target = String(req.params.userId);
  try {
    const access = await getAccess(target);
    if (!access) return res.status(404).json({ error: "unknown user" });
    if (access.status !== "waitlisted")
      return res.json({ ok: true, status: access.status }); // already through — idempotent
    await adminUnlock(target); // waitlist entry (if any) reads as unlocked
    await setStatus(target, "pending_onboarding");
    res.json({ ok: true, status: "pending_onboarding" });
  } catch (e) {
    res.status(500).json(asError(e));
  }
});

/** Resumable onboarding state. */
app.get("/api/onboarding", async (req, res) => {
  const { userId } = auth(req);
  try {
    res.json(await getOnboarding(userId));
  } catch (e) {
    res.status(500).json(asError(e));
  }
});

/** Persist one onboarding step (merge). */
app.patch("/api/onboarding", async (req, res) => {
  const { userId } = auth(req);
  try {
    const body = req.body ?? {};
    const profile =
      body.profile && typeof body.profile === "object"
        ? {
            name: str(body.profile.name, 120),
            city: str(body.profile.city, 120),
            language: str(body.profile.language, 40),
            photo: str(body.profile.photo, 2000),
          }
        : undefined;
    const next = await saveStep(userId, {
      step: typeof body.step === "string" ? (body.step as OnboardingStep) : undefined,
      topics: Array.isArray(body.topics) ? body.topics : undefined,
      lookingFor: Array.isArray(body.lookingFor) ? body.lookingFor : undefined,
      profile,
    });
    res.json(next);
  } catch (e) {
    res.status(500).json(asError(e));
  }
});

/**
 * First recommendation from the INVITER's network (the aha-moment). The new user
 * has no edges of their own, so we transfer trust from their inviter, scoped to
 * the requested topic. Falls back to nothing if the inviter has no in-scope
 * trust (the UI degrades to a friendly "explore" state).
 */
app.get("/api/onboarding/first-rec", async (req, res) => {
  const { userId } = auth(req);
  const topic = String(req.query.topic ?? "").trim();
  try {
    const access = await getAccess(userId);
    const seedId = access?.inviterId;
    if (!topic || !seedId || !shared.nodes.some((n) => n.id === seedId)) {
      return res.json({ recommendations: [] });
    }
    const recs = computeTrustRecommendations(shared.nodes, shared.links, seedId, { topic }, { limit: 3 });
    const labelOf = new Map(shared.nodes.map((n) => [n.id, n.label] as const));
    const enriched = recs.map((r) => {
      const node = shared.nodes.find((n) => n.id === r.nodeId);
      return {
        ...r,
        label: labelOf.get(r.nodeId) ?? r.nodeId,
        nodeType: node?.type,
        sub: node?.sub,
        entityType: node?.entityType,
        properties: node?.properties,
        viaLabels: r.via.map((id) => labelOf.get(id) ?? id),
      };
    });
    res.json({ recommendations: enriched, seededFrom: labelOf.get(seedId) ?? "your inviter" });
  } catch (e) {
    res.status(500).json(asError(e));
  }
});

/**
 * Complete onboarding: create the INVITED edge (once), flip status to `active`,
 * and — if the inviter is a waitlisted user — credit their referral toward
 * unlock. All origin/graph side-effects happen HERE, never at registration.
 */
app.post("/api/onboarding/complete", async (req, res) => {
  const { userId, meta } = auth(req);
  try {
    const firstCompletion = await completeOnboarding(userId);
    const access = await getAccess(userId);
    const inviterId = access?.inviterId;
    const hasInviter = !!inviterId && shared.nodes.some((n) => n.id === inviterId);
    // All graph side-effects happen once, on first completion.
    if (firstCompletion) {
      const ob = await getOnboarding(userId);
      await serialize(() => {
        let ws = applyOnboardingProfile(workingSet(userId, meta), userId, ob);
        // The one place the inviter connection enters the graph.
        if (hasInviter) ws = addInviteEdge(ws, inviterId!, userId);
        return commitGraph(userId, ws);
      });
      // Credit the referral if the inviter is still on the waitlist.
      if (hasInviter) {
        const ref = await incrementReferral(inviterId!);
        if (ref.unlockedNow) await setStatus(inviterId!, "pending_onboarding");
      }
    }
    await setStatus(userId, "active");
    res.json({ ok: true, status: "active" });
  } catch (e) {
    res.status(500).json(asError(e));
  }
});

/* ------------------------- catalog browse -------------------------- */
/* Browse the shared places catalog by topic (+ optional near-me distance) —
 * the discovery surface for restaurants nobody in your network trusts YET.
 * You then trust one (trust-native), and it enters your galaxy + trust search. */

app.get("/api/places", (req, res) => {
  const { userId } = auth(req);
  const topic = String(req.query.topic ?? "");
  if (!topic) return res.status(400).json({ error: "topic required" });
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const here = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  const radius = req.query.radiusKm ? Number(req.query.radiusKm) : null;
  const geo = req.query.geo ? geoKey(String(req.query.geo)) : undefined;
  const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 20)));

  // Entity types whose trust-topic is (or rolls up to) the query topic.
  const wantTypes = new Set(
    ENTITY_TYPES.filter((t) => t.topic === topic || TOPIC_PARENT[t.topic] === topic).map((t) => t.id),
  );
  const iTrust = new Set(
    shared.links
      .filter((l) => l.type === "TRUSTS" && (typeof l.source === "string" ? l.source : l.source.id) === userId)
      .map((l) => (typeof l.target === "string" ? l.target : l.target.id)),
  );

  const rows = shared.nodes
    .filter((n) => n.entityType && wantTypes.has(n.entityType))
    .map((n) => ({
      nodeId: n.id,
      label: n.label,
      sub: n.sub,
      entityType: n.entityType,
      properties: n.properties,
      lat: n.lat,
      lng: n.lng,
      distanceKm:
        here && typeof n.lat === "number" && typeof n.lng === "number"
          ? Math.round(haversineKm(here, { lat: n.lat, lng: n.lng }) * 10) / 10
          : undefined,
      trusted: iTrust.has(n.id),
      geoMatch: geo ? n.properties?.geo === geo : undefined,
    }))
    .filter((p) => !radius || p.distanceKm === undefined || p.distanceKm <= radius)
    .sort((a, b) => {
      if (here) return (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9);
      if (geo) return (b.geoMatch ? 1 : 0) - (a.geoMatch ? 1 : 0);
      return a.label.localeCompare(b.label);
    });

  res.json({ topic, places: rows.slice(0, limit) });
});

/** Full detail for one place: identity + distance + the trust layer (network
 *  score, who-trusts because-path, reason tally, outcomes) + similar nearby. */
app.get("/api/places/:id", async (req, res) => {
  const { userId } = auth(req);
  const id = String(req.params.id);
  const node = shared.nodes.find((n) => n.id === id);
  if (!node) return res.status(404).json({ error: "not found" });
  const topic = node.entityType ? topicForEntityType(node.entityType) : undefined;
  const eid = (v: string | GNode): string => (typeof v === "string" ? v : v.id);
  const labelOf = new Map(shared.nodes.map((n) => [n.id, n.label] as const));

  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const here = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  const distanceKm =
    here && typeof node.lat === "number" && typeof node.lng === "number"
      ? Math.round(haversineKm(here, { lat: node.lat, lng: node.lng }) * 10) / 10
      : undefined;

  // Who trusts this provider (+ reason tally).
  const trustEdges = shared.links.filter((l) => l.type === "TRUSTS" && l.trust && eid(l.target) === id);
  const trusters = trustEdges.map((l) => ({
    id: eid(l.source),
    name: labelOf.get(eid(l.source)) ?? eid(l.source),
    confidence: l.trust!.confidence,
    reasons: l.trust!.reasons ?? [],
    note: typeof l.trust!.note === "string" ? l.trust!.note : undefined,
    outcome: l.trust!.outcome ?? 0,
  }));
  const reasonTally: Record<string, number> = {};
  for (const l of trustEdges) for (const r of l.trust!.reasons ?? []) reasonTally[r] = (reasonTally[r] ?? 0) + 1;

  // Network trust score + because-path, from the viewer's perspective.
  let score = 0;
  let hops = 0;
  let because: string[] = [];
  if (topic) {
    const recs = computeTrustRecommendations(shared.nodes, shared.links, userId, { topic });
    const r = recs.find((x) => x.nodeId === id);
    if (r) {
      score = r.score;
      hops = r.trustPath?.length ?? 1;
      because = [labelOf.get(userId) ?? "You", ...(r.trustPath ?? []).map((h) => labelOf.get(h.to) ?? h.to)];
    }
  }

  const outcomes = await outcomeStats(id);
  const saved = await isSaved(userId, id);

  // Similar nearby (same topic, excluding this one).
  const wantTypes = new Set(
    ENTITY_TYPES.filter((t) => topic && (t.topic === topic || TOPIC_PARENT[t.topic] === topic)).map((t) => t.id),
  );
  const origin =
    here ?? (typeof node.lat === "number" && typeof node.lng === "number" ? { lat: node.lat, lng: node.lng } : null);
  const similar = shared.nodes
    .filter((n) => n.id !== id && n.entityType && wantTypes.has(n.entityType))
    .map((n) => ({
      nodeId: n.id,
      label: n.label,
      entityType: n.entityType,
      cuisine: Array.isArray(n.properties?.cuisine) ? (n.properties!.cuisine as string[]) : undefined,
      distanceKm:
        origin && typeof n.lat === "number" && typeof n.lng === "number"
          ? Math.round(haversineKm(origin, { lat: n.lat, lng: n.lng }) * 10) / 10
          : undefined,
    }))
    .sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9))
    .slice(0, 4);

  // Menu — dishes modeled as menu_item nodes PART_OF this place.
  const menu = shared.links
    .filter((l) => l.type === "PART_OF" && eid(l.target) === id)
    .map((l) => shared.nodes.find((n) => n.id === eid(l.source)))
    .filter((n): n is GNode => !!n && n.type === "menu_item")
    .map((n) => ({
      nodeId: n.id,
      label: n.label,
      price: typeof n.properties?.price === "string" ? n.properties.price : undefined,
      description: typeof n.properties?.description === "string" ? n.properties.description : undefined,
      dietary: Array.isArray(n.properties?.dietary) ? (n.properties!.dietary as string[]) : undefined,
      image: typeof n.properties?.image === "string" ? n.properties.image : undefined,
    }));

  res.json({
    node: {
      id: node.id,
      label: node.label,
      sub: node.sub,
      entityType: node.entityType,
      properties: node.properties,
      lat: node.lat,
      lng: node.lng,
      photos: node.photos,
    },
    topic,
    distanceKm,
    saved,
    menu,
    trust: {
      score,
      hops,
      because,
      count: trusters.length,
      iTrust: trustEdges.some((l) => eid(l.source) === userId),
      trusters: trusters.slice(0, 8),
      reasonTally,
      outcomes,
    },
    similar,
  });
});

/* --------------------- saved places ("lists") ---------------------- */

/** Save a catalog place to the viewer's list (a private bookmark, not trust). */
app.post("/api/places/:id/save", async (req, res) => {
  const { userId } = auth(req);
  const id = String(req.params.id);
  if (!shared.nodes.some((n) => n.id === id)) return res.status(404).json({ error: "not found" });
  const note = typeof req.body?.note === "string" ? req.body.note : undefined;
  await savePlace(userId, id, "saved", note);
  res.json({ saved: true });
});

app.delete("/api/places/:id/save", async (req, res) => {
  const { userId } = auth(req);
  await unsavePlace(userId, String(req.params.id), "saved");
  res.json({ saved: false });
});

/** The viewer's saved places, hydrated with node identity for the list view. */
app.get("/api/places/saved/list", async (req, res) => {
  const { userId } = auth(req);
  const rows = await listSaved(userId);
  const byId = new Map(shared.nodes.map((n) => [n.id, n] as const));
  const places = rows
    .map((r) => {
      const n = byId.get(r.nodeId);
      if (!n) return null;
      return {
        nodeId: n.id,
        label: n.label,
        sub: n.sub,
        entityType: n.entityType,
        properties: n.properties,
        lat: n.lat,
        lng: n.lng,
        note: r.note,
        savedAt: r.at,
      };
    })
    .filter(Boolean);
  res.json({ places });
});

/* ----------------------- menu (dishes as nodes) -------------------- */

const slug = (s: string): string =>
  s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);

/** Normalize + validate a dish payload from a request body (throws on bad name). */
function dishPayload(body: unknown): { name: string; price?: string; description?: string; dietary: string[]; image?: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = String(b.name ?? "").trim();
  if (!name) throw new Error("name required");
  return {
    name: name.slice(0, 80),
    price: typeof b.price === "string" ? b.price.trim().slice(0, 20) : undefined,
    description: typeof b.description === "string" ? b.description.trim().slice(0, 280) : undefined,
    dietary: Array.isArray(b.dietary) ? (b.dietary as unknown[]).map(String).filter((d) => DIETARY_OPTIONS.has(d)) : [],
    image: typeof b.image === "string" && okPhotoUrl(b.image) ? b.image : undefined,
  };
}

/** Create/update a menu_item node PART_OF a place (idempotent by name). */
async function applyMenu(placeId: string, dish: ReturnType<typeof dishPayload>): Promise<string> {
  const dishId = `menu_${placeId}_${slug(dish.name)}`;
  const properties: Record<string, unknown> = {};
  if (dish.price) properties.price = dish.price;
  if (dish.description) properties.description = dish.description;
  if (dish.dietary.length) properties.dietary = dish.dietary;
  if (dish.image) properties.image = dish.image;
  await serialize(async () => {
    const existingNode = shared.nodes.find((n) => n.id === dishId);
    const node: GNode = {
      id: dishId,
      type: "menu_item",
      label: dish.name,
      sub: [dish.price, dish.dietary.join("/")].filter(Boolean).join(" · ") || undefined,
      clusters: ["food"],
      properties,
      source: "user",
    };
    const hasEdge = shared.links.some(
      (l) => l.type === "PART_OF" && endId(l.source) === dishId && endId(l.target) === placeId,
    );
    const nodes = existingNode ? shared.nodes.map((n) => (n.id === dishId ? { ...n, ...node } : n)) : [...shared.nodes, node];
    const links = hasEdge
      ? shared.links
      : [...shared.links, { id: `pf_${dishId}`, source: dishId, target: placeId, type: "PART_OF" as const, weight: 1, scope: "global" as const }];
    await commitShared({ nodes, links, meId: "system", recommendations: [] });
  });
  return dishId;
}

/** A user proposes a dish → moderation queue (admin approves before it goes live). */
app.post("/api/places/:id/menu", async (req, res) => {
  const { userId } = auth(req);
  const id = String(req.params.id);
  const place = shared.nodes.find((n) => n.id === id);
  if (!place || (place.entityType !== "restaurant" && place.entityType !== "cafe")) {
    return res.status(404).json({ error: "not a place" });
  }
  try {
    const dish = dishPayload(req.body);
    const sid = await createSuggestion({ placeId: id, userId, kind: "menu", patch: dish });
    res.json({ ok: true, pending: true, id: sid });
  } catch (e) {
    res.status(400).json(asError(e));
  }
});

/** Remove a dish from a place's menu (removes the node + its PART_OF edge). */
app.delete("/api/places/:id/menu/:dishId", async (req, res) => {
  auth(req);
  const id = String(req.params.id);
  const dishId = String(req.params.dishId);
  try {
    await serialize(async () => {
      const nodes = shared.nodes.filter((n) => n.id !== dishId);
      const links = shared.links.filter(
        (l) => !(l.type === "PART_OF" && endId(l.source) === dishId && endId(l.target) === id),
      );
      await commitShared({ nodes, links, meId: "system", recommendations: [] });
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json(asError(e));
  }
});

/* --------------------- community photos ---------------------------- */
/* The BFF owns the bytes (uploads volume); here we only track the URL list on
 * the place node. Photos are catalog data (shared/global), user-contributable. */

const PHOTO_CAP = 40;
const okPhotoUrl = (u: unknown): u is string =>
  typeof u === "string" && (/^https?:\/\//i.test(u) || u.startsWith("/api/media/"));

/** Attach a photo URL to a place's gallery (dedup, capped). Returns the list. */
async function applyPhoto(placeId: string, url: string): Promise<string[]> {
  let photos: string[] = [];
  await serialize(async () => {
    const nodes = shared.nodes.map((n) => {
      if (n.id !== placeId) return n;
      photos = Array.from(new Set([...(n.photos ?? []), url])).slice(0, PHOTO_CAP);
      return { ...n, photos };
    });
    await commitShared({ nodes, links: shared.links, meId: "system", recommendations: [] });
  });
  return photos;
}

/** A user submits a photo → moderation queue (admin approves before it shows). */
app.post("/api/places/:id/photos", async (req, res) => {
  const { userId } = auth(req);
  const id = String(req.params.id);
  const url = req.body?.url;
  if (!okPhotoUrl(url)) return res.status(400).json({ error: "valid url required" });
  const place = shared.nodes.find((n) => n.id === id);
  if (!place || (place.entityType !== "restaurant" && place.entityType !== "cafe")) {
    return res.status(404).json({ error: "not a place" });
  }
  try {
    const sid = await createSuggestion({ placeId: id, userId, kind: "photo", patch: { url } });
    res.json({ ok: true, pending: true, id: sid });
  } catch (e) {
    res.status(400).json(asError(e));
  }
});

/** Remove a photo URL from a place's gallery. */
app.delete("/api/places/:id/photos", async (req, res) => {
  auth(req);
  const id = String(req.params.id);
  const url = String(req.body?.url ?? "");
  try {
    let photos: string[] = [];
    await serialize(async () => {
      const nodes = shared.nodes.map((n) => {
        if (n.id !== id) return n;
        photos = (n.photos ?? []).filter((p) => p !== url);
        return { ...n, photos: photos.length ? photos : undefined };
      });
      await commitShared({ nodes, links: shared.links, meId: "system", recommendations: [] });
    });
    res.json({ ok: true, photos });
  } catch (e) {
    res.status(400).json(asError(e));
  }
});

/* ----------------- edit: update + suggest → approve ---------------- */

/** Apply a validated field patch to a place (admin edit or approved suggestion).
 *  Gated as admin at the BFF; place nodes are global → commitShared. */
async function applyPlaceUpdate(id: string, patch: { label?: string; properties?: Record<string, unknown> }): Promise<void> {
  await serialize(async () => {
    const next = updateEntity(
      { nodes: shared.nodes, links: shared.links, meId: "system", recommendations: [] },
      { id, label: patch.label, properties: patch.properties, now: Date.now() },
    );
    await commitShared(next);
  });
}

app.put("/api/places/:id", async (req, res) => {
  auth(req); // admin-gated at the BFF
  const id = String(req.params.id);
  const place = shared.nodes.find((n) => n.id === id);
  if (!place || (place.entityType !== "restaurant" && place.entityType !== "cafe")) {
    return res.status(404).json({ error: "not a place" });
  }
  const label = typeof req.body?.label === "string" ? req.body.label : undefined;
  const properties =
    req.body?.properties && typeof req.body.properties === "object" ? (req.body.properties as Record<string, unknown>) : undefined;
  try {
    await applyPlaceUpdate(id, { label, properties });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json(asError(e));
  }
});

/** Admin: delete a place — removes the node, its menu_item children, and every
 *  edge touching them (trust, part_of, …). Admin-gated at the BFF. */
app.delete("/api/places/:id", async (req, res) => {
  auth(req);
  const id = String(req.params.id);
  if (!shared.nodes.some((n) => n.id === id)) return res.status(404).json({ error: "not found" });
  try {
    await serialize(async () => {
      // menu_item children linked PART_OF this place
      const childIds = new Set(
        shared.links
          .filter((l) => l.type === "PART_OF" && endId(l.target) === id)
          .map((l) => endId(l.source)),
      );
      const dead = new Set<string>([id, ...childIds]);
      const nodes = shared.nodes.filter((n) => !dead.has(n.id));
      const links = shared.links.filter((l) => !dead.has(endId(l.source)) && !dead.has(endId(l.target)));
      await commitShared({ nodes, links, meId: "system", recommendations: [] });
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json(asError(e));
  }
});

/** Any user proposes an edit to a place's core fields → moderation queue. */
app.post("/api/places/:id/suggest", async (req, res) => {
  const { userId } = auth(req);
  const id = String(req.params.id);
  if (!shared.nodes.some((n) => n.id === id)) return res.status(404).json({ error: "not found" });
  const patch = req.body?.patch && typeof req.body.patch === "object" ? (req.body.patch as Record<string, unknown>) : null;
  if (!patch || !Object.keys(patch).length) return res.status(400).json({ error: "patch required" });
  const note = typeof req.body?.note === "string" ? req.body.note.slice(0, 280) : undefined;
  try {
    const sid = await createSuggestion({ placeId: id, userId, patch, note });
    res.json({ ok: true, id: sid });
  } catch (e) {
    res.status(400).json(asError(e));
  }
});

/** Admin: pending suggestions, hydrated with the place label. */
app.get("/api/admin/place-suggestions", async (req, res) => {
  auth(req); // admin-gated at the BFF
  const status = typeof req.query.status === "string" ? req.query.status : "pending";
  const rows = await listSuggestions(status);
  const byId = new Map(shared.nodes.map((n) => [n.id, n] as const));
  res.json({
    suggestions: rows.map((s) => ({ ...s, placeLabel: byId.get(s.placeId)?.label ?? s.placeId })),
  });
});

app.post("/api/admin/place-suggestions/:sid/approve", async (req, res) => {
  const { userId } = auth(req); // admin-gated at the BFF
  const sid = Number(req.params.sid);
  try {
    const s = await getSuggestion(sid);
    if (!s) return res.status(404).json({ error: "not found" });
    // Apply per kind: edit → field patch, photo → attach URL, menu → create dish.
    if (s.kind === "photo") {
      if (okPhotoUrl(s.patch.url)) await applyPhoto(s.placeId, String(s.patch.url));
    } else if (s.kind === "menu") {
      await applyMenu(s.placeId, dishPayload(s.patch));
    } else {
      const { label, ...properties } = s.patch as { label?: string } & Record<string, unknown>;
      await applyPlaceUpdate(s.placeId, { label: typeof label === "string" ? label : undefined, properties });
    }
    await setSuggestionStatus(sid, "approved", userId);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json(asError(e));
  }
});

app.post("/api/admin/place-suggestions/:sid/reject", async (req, res) => {
  const { userId } = auth(req); // admin-gated at the BFF
  const sid = Number(req.params.sid);
  try {
    await setSuggestionStatus(sid, "rejected", userId);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json(asError(e));
  }
});

/** Admin: the ENTIRE places catalog (no topic/geo/trust filter, uncapped) with
 *  photo + menu counts — the management list. Admin-gated at the BFF. */
app.get("/api/admin/places", (req, res) => {
  auth(req);
  const menuCount = new Map<string, number>();
  for (const l of shared.links) {
    if (l.type !== "PART_OF") continue;
    const t = endId(l.target);
    menuCount.set(t, (menuCount.get(t) ?? 0) + 1);
  }
  const places = shared.nodes
    .filter((n) => n.entityType === "restaurant" || n.entityType === "cafe")
    .map((n) => ({
      nodeId: n.id,
      label: n.label,
      entityType: n.entityType,
      properties: n.properties,
      photos: n.photos ?? [],
      lat: n.lat,
      lng: n.lng,
      photoCount: (n.photos ?? []).length,
      menuCount: menuCount.get(n.id) ?? 0,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
  res.json({ places });
});

/* ----------------- add a place by maps link (connector) ------------ */

/** Admin submits a Google/Yandex Maps URL → queued to the places connector via
 *  NATS, which resolves + upserts the restaurant. Admin-gated at the BFF. */
app.post("/api/admin/places/link", async (req, res) => {
  const { userId } = auth(req);
  const url = String(req.body?.url ?? "").trim();
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: "a valid http(s) URL is required" });
  const source = detectLinkSource(url);
  if (!source) return res.status(400).json({ error: "only Google Maps or Yandex Maps links are supported" });
  if (!natsConn) return res.status(503).json({ error: "ingestion queue (NATS) is unavailable" });
  try {
    const id = await createPlaceLink(url, source, userId);
    natsConn.publish(
      NATS_SUBJECTS.PLACE_LINK_SUBMITTED,
      JSONCodec().encode({ linkId: String(id), url, source }),
    );
    res.json({ ok: true, id, source, status: "queued" });
  } catch (e) {
    res.status(400).json(asError(e));
  }
});

/** Admin: recently submitted links + their resolution status. */
app.get("/api/admin/places/links", async (req, res) => {
  auth(req);
  const links = await listPlaceLinks(Math.min(100, Math.max(1, Number(req.query.limit ?? 50))));
  res.json({ links });
});

/** Admin: dismiss a link-history row (does not delete the imported place). */
app.delete("/api/admin/places/links/:id", async (req, res) => {
  auth(req);
  await deletePlaceLink(Number(req.params.id));
  res.json({ ok: true });
});

/* ------------------------- taste import ---------------------------- */
/* Import a user's own places (Google Takeout / Foursquare / paste) → their
 * trust edges, jump-starting their graph. Answer/vouch stays trust-native. */

const geoKey = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, "_");

app.post("/api/import/places", async (req, res) => {
  const { userId, meta } = auth(req);
  const items = Array.isArray(req.body?.places) ? req.body.places : [];
  if (!items.length) return res.status(400).json({ error: "places[] required" });
  try {
    let imported = 0;
    let created = 0;
    await serialize(async () => {
      let next = workingSet(userId, meta);
      const now = Date.now();
      for (const raw of items.slice(0, 300)) {
        const name = String(raw?.name ?? "").trim();
        if (!name) continue;
        const geo = raw?.geo ? geoKey(String(raw.geo)) : undefined;
        const rating = Number(raw?.rating);
        const confidence = Number.isFinite(rating) && rating > 0 ? Math.max(0.2, Math.min(1, rating / 5)) : 0.75;

        // Resolve to a catalog node: external id → name(+geo) match → create.
        let nodeId: string | undefined;
        if (raw?.source && raw?.externalId) {
          const id = `place_${String(raw.source)}_${String(raw.externalId).replace(/[^a-zA-Z0-9]+/g, "_")}`;
          if (next.nodes.some((n) => n.id === id)) nodeId = id;
        }
        if (!nodeId) {
          const match = next.nodes.find(
            (n) =>
              (n.entityType === "restaurant" || n.entityType === "cafe") &&
              normLabel(n.label) === normLabel(name) &&
              (!geo || n.properties?.geo === geo),
          );
          if (match) nodeId = match.id;
        }
        if (!nodeId) {
          const r = createEntity(next, {
            entityType: "restaurant",
            label: name,
            properties: geo ? { geo } : {},
            now,
          });
          nodeId = r.nodeId;
          next = r.dataset;
          created++;
        }

        const node = next.nodes.find((n) => n.id === nodeId);
        const topic = (node?.entityType && topicForEntityType(node.entityType)) || "restaurant";
        try {
          next = addTrustEdge(next, userId, nodeId, { topic, geo }, { confidence, source: "explicit", now });
          imported++;
        } catch {
          /* skip an item that can't form a valid trust edge */
        }
      }
      await commitGraph(userId, next);
    });
    res.json({ ok: true, imported, created });
  } catch (e) {
    res.status(400).json(asError(e));
  }
});

/* ---------------------------- signals ------------------------------ */
/* Search + interaction capture feeding the blended recommender (Phase B). */

/** Log a resolve-scope NL search (called by the BFF after a query resolves). */
app.post("/api/search/log", (req, res) => {
  const { userId } = auth(req);
  const { rawQuery, topic, geo, context } = req.body ?? {};
  void recordSearch({
    userId,
    rawQuery: rawQuery ? String(rawQuery) : undefined,
    topic: topic ? String(topic) : undefined,
    geo: geo ? String(geo) : undefined,
    context: context ? String(context) : undefined,
    source: "resolve-scope",
  });
  res.json({ ok: true });
});

/** Batch-log browser interactions (impressions/clicks of rendered recs). */
app.post("/api/interactions", (req, res) => {
  const { userId } = auth(req);
  const raw = Array.isArray(req.body?.events) ? req.body.events : [];
  const events: InteractionInput[] = [];
  for (const e of raw) {
    if (!e || typeof e.nodeId !== "string") continue;
    const kind: InteractionKind = e.kind === "click" ? "click" : "impression";
    events.push({ userId, nodeId: e.nodeId, kind, topic: typeof e.topic === "string" ? e.topic : undefined });
  }
  void recordInteractions(events);
  res.json({ ok: true, accepted: events.length });
});

/* ---------------------------- outcomes ----------------------------- */
/* Productized "did it work out?" loop — pending follow-ups (Feature 6). */

/** Record intent to use a provider → a pending follow-up prompt. */
app.post("/api/outcomes/intent", async (req, res) => {
  const { userId } = auth(req);
  const { nodeId, edgeId, topic, geo } = req.body ?? {};
  if (!nodeId) return res.status(400).json({ error: "nodeId required" });
  try {
    const label = shared.nodes.find((n) => n.id === String(nodeId))?.label;
    await createPrompt({
      userId,
      nodeId: String(nodeId),
      edgeId: edgeId ? String(edgeId) : undefined,
      topic: topic ? String(topic) : undefined,
      geo: geo ? String(geo) : undefined,
      label,
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json(asError(e));
  }
});

/** Pending "did it work out?" prompts due for the viewer. */
app.get("/api/outcomes/pending", async (req, res) => {
  const { userId } = auth(req);
  try {
    const prompts = await pendingPrompts(userId);
    const labelOf = new Map(shared.nodes.map((n) => [n.id, n.label] as const));
    res.json(prompts.map((p) => ({ ...p, label: p.label ?? labelOf.get(p.nodeId) ?? p.nodeId })));
  } catch (e) {
    res.status(500).json(asError(e));
  }
});

/** Resolve a prompt: worked (+1) / didn't (-1) / dismissed (0). Applies the
 *  outcome to the terminal trust edge + logs it authoritatively. */
app.post("/api/outcomes/resolve", async (req, res) => {
  const { userId, meta } = auth(req);
  const { id, value } = req.body ?? {};
  const v = Math.max(-1, Math.min(1, Number(value ?? 0)));
  const status = v > 0 ? "worked" : v < 0 ? "failed" : "dismissed";
  try {
    const resolved = await resolvePrompt(userId, String(id), status);
    if (!resolved) return res.json({ ok: false });
    if (resolved.edgeId && v !== 0) {
      const edge = shared.links.find((l) => l.id === resolved.edgeId);
      await serialize(() =>
        commitGraph(userId, applyOutcomeToEdge(workingSet(userId, meta), resolved.edgeId!, v, Date.now())),
      );
      if (edge?.trust) {
        await recordOutcome({
          edgeId: resolved.edgeId,
          fromId: typeof edge.source === "string" ? edge.source : edge.source.id,
          toId: typeof edge.target === "string" ? edge.target : edge.target.id,
          userId,
          recNodeId: resolved.nodeId,
          kind: v >= 0 ? "positive" : "negative",
          value: v,
          scope: edge.trust.scope,
        });
      }
    }
    res.json({ ok: true, status });
  } catch (e) {
    res.status(400).json(asError(e));
  }
});

/* ------------------------------- asks ------------------------------ */
/* Ask-my-network — a cold-start dead end becomes a broadcast; a friend's
 * answer creates the TRUSTS edge that makes the asker's search succeed. */

/** People the user is friends with (FRIENDS_WITH neighbors, either direction). */
/**
 * The people who count as "your network" for asks. Broader than friendship:
 * at an event you connect via SAVED / MET_AT / TRUSTS, not FRIENDS_WITH — so an
 * intro ask must reach everyone you've actually engaged with, in either
 * direction. Persons only (an ask is answered by a person).
 */
const NETWORK_EDGE_TYPES = new Set(["FRIENDS_WITH", "SAVED", "MET_AT", "TRUSTS"]);
function networkIdsOf(userId: string): string[] {
  const persons = new Set(shared.nodes.filter((n) => n.type === "person").map((n) => n.id));
  const s = new Set<string>();
  for (const l of shared.links) {
    if (!NETWORK_EDGE_TYPES.has(String(l.type))) continue;
    const a = typeof l.source === "string" ? l.source : l.source.id;
    const b = typeof l.target === "string" ? l.target : l.target.id;
    if (a === userId && persons.has(b)) s.add(b);
    if (b === userId && persons.has(a)) s.add(a);
  }
  s.delete(userId);
  return [...s];
}

/** The ontology entity type that answers a given trust topic (dentist → dentist). */
function entityTypeForTopic(topic: string): string | undefined {
  return ENTITY_TYPES.find((t) => t.topic === topic)?.id;
}

/** Broadcast an ask to your sky. */
app.post("/api/asks", async (req, res) => {
  const { userId } = auth(req);
  if (!asksEnabled()) return res.status(503).json({ error: "asks unavailable" });
  const { topic, geo, note } = req.body ?? {};
  if (!topic) return res.status(400).json({ error: "topic required" });
  try {
    res.json(
      await createAsk(userId, {
        topic: String(topic),
        geo: geo ? String(geo) : undefined,
        note: note ? String(note).slice(0, 200) : undefined,
        app: appOf(req),
      }),
    );
  } catch (e) {
    res.status(500).json(asError(e));
  }
});

/** The viewer's own asks + the answers they've received. */
app.get("/api/asks/mine", async (req, res) => {
  const { userId } = auth(req);
  try {
    const asks = await myAsks(userId, appOf(req));
    const labelOf = new Map(shared.nodes.map((n) => [n.id, n.label] as const));
    res.json(
      asks.map((a) => ({
        ...a,
        answers: a.answers.map((ans) => ({
          ...ans,
          providerLabel: labelOf.get(ans.nodeId) ?? ans.nodeId,
          responderName: labelOf.get(ans.responderId) ?? "A friend",
        })),
      })),
    );
  } catch (e) {
    res.status(500).json(asError(e));
  }
});

/** Open asks from your friends that you can answer. */
app.get("/api/asks/inbox", async (req, res) => {
  const { userId } = auth(req);
  try {
    const asks = await asksInbox(userId, networkIdsOf(userId), appOf(req));
    const labelOf = new Map(shared.nodes.map((n) => [n.id, n.label] as const));
    res.json(asks.map((a) => ({ ...a, askerName: labelOf.get(a.askerId) ?? "A friend" })));
  } catch (e) {
    res.status(500).json(asError(e));
  }
});

/** Answer an ask by naming a provider — creates a real TRUSTS edge for you. */
app.post("/api/asks/:id/answer", async (req, res) => {
  const { userId, meta } = auth(req);
  const askId = String(req.params.id);
  const { label, nodeId, note } = req.body ?? {};
  try {
    const ask = await getAsk(askId);
    if (!ask || ask.status === "closed") return res.json({ ok: false, reason: "gone" });
    if (ask.askerId === userId) return res.json({ ok: false, reason: "self" });
    const topic = ask.topic;
    const geo = ask.geo;
    // In an event/space (non-general app) an answer is a *recommendation* — you
    // point at any existing entity (person, startup, …) or invite a newcomer.
    // No topic trust edge is minted; the recommendation surfaces via the answer
    // record on the asker's panel. The general app keeps its "vouch = trust edge"
    // model where naming a provider grows your trust graph.
    const isRecommendation = (ask.app ?? BUILTIN_APP) !== BUILTIN_APP;

    const result = await serialize(async () => {
      let next = workingSet(userId, meta);
      let providerId =
        nodeId && shared.nodes.some((n) => n.id === String(nodeId)) ? String(nodeId) : undefined;

      if (isRecommendation) {
        // Recommend any existing entity; creating one isn't allowed here (use invite).
        if (!providerId) throw new Error("pick an entity to recommend");
        await commitGraph(userId, next);
        return { providerId, edgeId: undefined as string | undefined };
      }

      if (!providerId) {
        const name = String(label ?? "").trim();
        if (!name) throw new Error("provider name required");
        const et = entityTypeForTopic(topic);
        const existing = shared.nodes.find(
          (n) => n.entityType === et && normLabel(n.label) === normLabel(name),
        );
        if (existing) providerId = existing.id;
        else {
          if (!et) throw new Error(`no provider type for topic ${topic}`);
          const r = createEntity(next, { entityType: et, label: name, properties: {}, now: Date.now() });
          providerId = r.nodeId;
          next = r.dataset;
        }
      }
      // The answer IS an edge: the responder now trusts this provider on the topic.
      next = addTrustEdge(next, userId, providerId, { topic, geo }, {
        confidence: 0.85,
        source: "explicit",
        now: Date.now(),
      });
      await commitGraph(userId, next);
      const edge = shared.links.find(
        (l) =>
          l.type === "TRUSTS" &&
          (typeof l.source === "string" ? l.source : l.source.id) === userId &&
          (typeof l.target === "string" ? l.target : l.target.id) === providerId &&
          l.trust?.scope.topic === topic,
      );
      return { providerId, edgeId: edge?.id };
    });

    await recordAnswer({
      askId,
      responderId: userId,
      nodeId: result.providerId,
      edgeId: result.edgeId,
      note: note ? String(note).slice(0, 200) : undefined,
    });
    res.json({ ok: true, nodeId: result.providerId });
  } catch (e) {
    res.status(400).json(asError(e));
  }
});

/* ------------------------------ wallet ----------------------------- */
/* Per-user token economy — persisted in the user's :Meta.              */

app.post("/api/wallet/spend", async (req, res) => {
  const { userId, meta } = auth(req);
  const { amount, reason, ref } = req.body ?? {};
  try {
    res.json(
      await serialize(() =>
        commitMeta(
          userId,
          spendTokens(workingSet(userId, meta), Number(amount), (reason as WalletEntry["reason"]) ?? "peek", ref),
        ),
      ),
    );
  } catch (e) {
    res.status(400).json(asError(e));
  }
});

app.post("/api/wallet/earn", async (req, res) => {
  const { userId, meta } = auth(req);
  const { amount, reason, ref } = req.body ?? {};
  try {
    res.json(
      await serialize(() =>
        commitMeta(
          userId,
          earnTokens(workingSet(userId, meta), Number(amount), (reason as WalletEntry["reason"]) ?? "buy", ref),
        ),
      ),
    );
  } catch (e) {
    res.status(400).json(asError(e));
  }
});

app.post("/api/wallet/buy", async (req, res) => {
  const { userId, meta } = auth(req);
  const { amount } = req.body ?? {};
  try {
    res.json(
      await serialize(() =>
        commitMeta(userId, buyTokens(workingSet(userId, meta), amount != null ? Number(amount) : undefined)),
      ),
    );
  } catch (e) {
    res.status(400).json(asError(e));
  }
});

/** Reset the shared world to seed (dev only — wipes all users' overlays). */
app.post("/api/reset", async (req, res) => {
  const { userId } = auth(req);
  try {
    const seed = buildDataset(2026);
    userMeta.clear();
    await serialize(() => commitShared({ ...seed }));
    const meta = await ensureUser(userId, {});
    res.json(viewFor(userId, meta));
  } catch (e) {
    res.status(400).json(asError(e));
  }
});

/* ------------------------------ boot ------------------------------- */

async function main() {
  store = await createStore();
  shared = await store.loadGraph();
  rebuildGraph();
  await initWritings().catch((e) =>
    console.error("graph-service: writings init failed:", e instanceof Error ? e.message : e),
  );
  await initTrustLog().catch((e) =>
    console.error("graph-service: trust log init failed:", e instanceof Error ? e.message : e),
  );
  await initInvites().catch((e) =>
    console.error("graph-service: invites init failed:", e instanceof Error ? e.message : e),
  );
  await initReputation().catch((e) =>
    console.error("graph-service: reputation init failed:", e instanceof Error ? e.message : e),
  );
  await initRelationshipStrength().catch((e) =>
    console.error("graph-service: relationship strength init failed:", e instanceof Error ? e.message : e),
  );
  await initListen().catch((e) =>
    console.error("graph-service: listen init failed:", e instanceof Error ? e.message : e),
  );
  await initContribution().catch((e) =>
    console.error("graph-service: contribution init failed:", e instanceof Error ? e.message : e),
  );
  await initCredits().catch((e) =>
    console.error("graph-service: credits init failed:", e instanceof Error ? e.message : e),
  );
  await initAccess().catch((e) =>
    console.error("graph-service: access init failed:", e instanceof Error ? e.message : e),
  );
  await initWaitlist().catch((e) =>
    console.error("graph-service: waitlist init failed:", e instanceof Error ? e.message : e),
  );
  await initOnboarding().catch((e) =>
    console.error("graph-service: onboarding init failed:", e instanceof Error ? e.message : e),
  );
  await initOutcomePrompts().catch((e) =>
    console.error("graph-service: outcome prompts init failed:", e instanceof Error ? e.message : e),
  );
  await initAsks().catch((e) =>
    console.error("graph-service: asks init failed:", e instanceof Error ? e.message : e),
  );
  await initEmbeddings().catch((e) =>
    console.error("graph-service: embeddings init failed:", e instanceof Error ? e.message : e),
  );
  await initSearchLog().catch((e) =>
    console.error("graph-service: search log init failed:", e instanceof Error ? e.message : e),
  );
  await initInteractionLog().catch((e) =>
    console.error("graph-service: interaction log init failed:", e instanceof Error ? e.message : e),
  );
  await initSavedPlaces().catch((e) =>
    console.error("graph-service: saved places init failed:", e instanceof Error ? e.message : e),
  );
  await initPlaceSuggestions().catch((e) =>
    console.error("graph-service: place suggestions init failed:", e instanceof Error ? e.message : e),
  );
  await initPlaceLinks().catch((e) =>
    console.error("graph-service: place links init failed:", e instanceof Error ? e.message : e),
  );
  await initOntology()
    .then(reloadOntology)
    .catch((e) => console.error("graph-service: ontology init failed:", e instanceof Error ? e.message : e));
  await initMeetings().catch((e) =>
    console.error("graph-service: meetings init failed:", e instanceof Error ? e.message : e),
  );
  await initMeetingNotes().catch((e) =>
    console.error("graph-service: meeting notes init failed:", e instanceof Error ? e.message : e),
  );
  await initEventLocations().catch((e) =>
    console.error("graph-service: event locations init failed:", e instanceof Error ? e.message : e),
  );

  if (NATS_URL) {
    natsConn = await startNatsIngest({
      url: NATS_URL,
      // Connectors write to the shared substrate as a system actor (no user).
      getDataset: () => ({ nodes: shared.nodes, links: shared.links, meId: "system", recommendations: [] }),
      commit: (next) => serialize(() => commitShared(next)),
      // The places connector reports each resolved/failed maps link back to us.
      onLinkResolved: (ev) =>
        resolvePlaceLink(Number(ev.linkId), { ok: ev.ok, nodeId: ev.nodeId, label: ev.label, error: ev.error }),
    });
  } else {
    console.warn("graph-service: NATS_URL not set — connector ingestion disabled");
  }

  app.listen(PORT, () =>
    console.log(
      `graph-service listening on :${PORT} — ${store.kind} storage, ${shared.nodes.length} shared nodes / ${shared.links.length} edges` +
        (NATS_URL ? ", nats ingest on" : ""),
    ),
  );
}

main().catch((e) => {
  console.error("graph-service failed to start:", e);
  process.exit(1);
});
