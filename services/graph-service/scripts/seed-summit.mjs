/**
 * Seed / re-author the "Trusty Sevan" summit app via the ontology admin API.
 * This drives the SAME endpoints the admin builder UI uses — the app stays fully
 * data-driven and editable in /admin/apps afterward. Idempotent (upserts).
 *
 * The multiselect `options` lists below double as the CURATED VOCABULARIES that
 * materialize into shared concept nodes (see graph-core summitGraph.ts) — needs
 * and offers share one vocabulary so need↔offer matching is equality-based.
 *
 * Run inside the graph-service container:
 *   docker compose exec graph-service node scripts/seed-summit.mjs
 */
const BASE = process.env.SEED_BASE ?? "http://localhost:4001";
const H = { "content-type": "application/json", "x-user-id": "seed-admin", "x-user-name": "Seed" };

async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, { method: "POST", headers: H, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${path} → ${r.status} ${JSON.stringify(j)}`);
  return j;
}

/* ---- curated vocabularies (drive both match scoring and concept nodes) ---- */
const SECTORS = ["fintech", "healthtech", "ai", "saas", "marketplace", "climate", "edtech", "ecommerce", "deeptech", "consumer", "gaming", "web3", "agritech", "traveltech"];
const SKILLS = ["engineering", "design", "product", "growth", "sales", "marketing", "data", "ops", "finance", "legal", "research", "community"];
const TECHNOLOGIES = ["ai", "ml", "llm", "react", "nextjs", "node", "python", "go", "graphql", "neo4j", "postgres", "kubernetes", "aws", "mobile", "flutter", "blockchain", "iot", "ar_vr", "data_engineering", "recommendation_systems"];
const NEED_OFFER = ["funding", "co_founder", "engineers", "designers", "marketing_help", "sales_help", "mentorship", "legal_help", "pilot_customers", "distribution", "cloud_credits", "investor_intros", "api_integration", "recommendation_api", "payments_api", "maps_api", "ai_api", "data_api", "auth_api", "messaging_api"];
const LOOKING_FOR = ["cofounder", "investment", "hiring", "mentorship", "pilot_customer", "feedback", "intro", "partnership"];
const PATHWAY = ["pre_incubation", "micro_incubation", "micro_acceleration"];
const STAGES = ["idea", "pre_seed", "seed", "series_a", "growth"];
const COUNTRIES = ["armenia", "georgia", "usa", "germany", "france", "uk", "netherlands", "estonia", "poland", "ukraine", "india", "uae", "other_europe", "other_asia", "other"];
const MARKETS = ["armenia", "caucasus", "europe", "mena", "usa", "global", "emerging_markets"];
const TRACKS = ["main_stage", "workshop_tent", "pitch_tent", "lakeside"];

const f = (key, label, type, extra = {}) => ({ key, label, type, ...extra });

/* Shared person-profile fragments (spec: PERSON PROFILE). */
const PERSON_COMMON = [
  f("headline", "Headline", "text", { placeholder: "one line about you" }),
  f("country", "Country", "select", { options: COUNTRIES }),
  f("technologies", "Technologies", "multiselect", { options: TECHNOLOGIES }),
  f("skills_offered", "Skills I offer", "multiselect", { options: SKILLS }),
  f("skills_needed", "Skills I need", "multiselect", { options: SKILLS }),
  f("interests", "Interests", "multiselect", { options: SECTORS }),
  f("needs", "Looking for (needs)", "multiselect", { options: NEED_OFFER }),
  f("offers", "Can help with (offers)", "multiselect", { options: NEED_OFFER }),
  f("can_help_with", "How I help", "text", { placeholder: "e.g. GTM strategy, intros" }),
  f("bio", "Short bio", "text"),
  f("website", "Website", "text"),
  f("linkedin", "LinkedIn", "text"),
];

const TYPES = [
  {
    id: "founder", label: "Founder", baseType: "person", topic: "founder", category: "people",
    fields: [
      ...PERSON_COMMON,
      f("sectors", "Sectors", "multiselect", { options: SECTORS }),
      f("stage", "Stage", "select", { options: STAGES }),
      f("looking_for", "Looking for", "multiselect", { options: LOOKING_FOR }),
      f("pathway", "Pathway", "select", { options: PATHWAY }),
    ],
  },
  {
    id: "mentor", label: "Mentor", baseType: "person", topic: "mentorship", category: "people",
    fields: [
      ...PERSON_COMMON,
      f("expertise", "Expertise", "multiselect", { options: SKILLS }),
      f("industries", "Industries", "multiselect", { options: SECTORS }),
      f("availability", "Availability", "text", { placeholder: "e.g. afternoons, tue-thu" }),
    ],
  },
  {
    id: "investor", label: "Investor", baseType: "person", topic: "investment", category: "people",
    fields: [
      ...PERSON_COMMON,
      f("firm", "Firm", "text"),
      f("kind", "Kind", "select", { options: ["angel", "vc", "syndicate", "accelerator"] }),
      f("check_size", "Check size", "money", { unit: "USD" }),
      f("stages", "Stages", "multiselect", { options: STAGES }),
      f("sectors", "Sectors", "multiselect", { options: SECTORS }),
      f("markets", "Geo focus", "multiselect", { options: MARKETS }),
      f("thesis", "Thesis", "text"),
    ],
  },
  {
    id: "expert", label: "Expert", baseType: "person", topic: "mentorship", category: "people",
    fields: [
      ...PERSON_COMMON,
      f("expertise", "Expertise", "multiselect", { options: SKILLS }),
      f("industries", "Industries", "multiselect", { options: SECTORS }),
    ],
  },
  {
    id: "speaker", label: "Speaker", baseType: "person", topic: "mentorship", category: "people",
    fields: [
      f("talk_topic", "Talk topic", "text"),
      f("org", "Organization", "text"),
      ...PERSON_COMMON,
    ],
  },
  {
    id: "startup", label: "Startup", baseType: "location", topic: "startup", category: "teams",
    fields: [
      f("one_liner", "One-liner", "text"),
      f("description", "Description", "text"),
      f("problem", "Problem", "text"),
      f("solution", "Solution", "text"),
      f("stage", "Stage", "select", { options: STAGES }),
      f("sectors", "Sectors", "multiselect", { options: SECTORS }),
      f("markets", "Target markets", "multiselect", { options: MARKETS }),
      f("business_model", "Business model", "select", { options: ["b2b", "b2c", "b2b2c", "marketplace", "api", "saas", "hardware"] }),
      f("technologies", "Technologies", "multiselect", { options: TECHNOLOGIES }),
      f("needs", "Needs", "multiselect", { options: NEED_OFFER }),
      f("offers", "Offers", "multiselect", { options: NEED_OFFER }),
      f("looking_for", "Looking for", "multiselect", { options: LOOKING_FOR }),
      f("open_positions", "Open positions", "multiselect", { options: SKILLS }),
      f("team_size", "Team size", "number"),
      f("raising", "Raising", "money", { unit: "USD" }),
      f("traction", "Traction", "text"),
      f("website", "Website", "text"),
      f("deck", "Pitch deck URL", "text"),
    ],
  },
  {
    id: "organization", label: "Organization", baseType: "location", topic: "partner", category: "orgs",
    fields: [
      f("kind", "Kind", "select", { options: ["accelerator", "vc_firm", "corporate", "university", "ngo", "government", "media"] }),
      f("description", "Description", "text"),
      f("sectors", "Sectors", "multiselect", { options: SECTORS }),
      f("offers", "Offers", "multiselect", { options: NEED_OFFER }),
      f("website", "Website", "text"),
    ],
  },
  {
    id: "partner", label: "Partner", baseType: "location", topic: "partner", category: "orgs",
    fields: [
      f("kind", "Kind", "select", { options: ["sponsor", "ecosystem", "accelerator", "media", "government"] }),
      f("offer", "What they offer", "text"),
      f("sectors", "Sectors", "multiselect", { options: SECTORS }),
      f("website", "Website", "text"),
    ],
  },
  {
    id: "workshop", label: "Workshop", baseType: "location", topic: "workshop", category: "programme",
    fields: [
      f("description", "Description", "text"),
      f("track", "Track", "select", { options: TRACKS }),
      f("time", "Time", "text", { placeholder: "e.g. Tue 15:00" }),
      f("topics", "Topics", "multiselect", { options: [...SECTORS, ...SKILLS] }),
      f("host", "Host", "text"),
    ],
  },
  {
    id: "session", label: "Session", baseType: "location", topic: "workshop", category: "programme",
    fields: [
      f("description", "Description", "text"),
      f("track", "Track", "select", { options: TRACKS }),
      f("time", "Time", "text", { placeholder: "e.g. Wed 20:00" }),
      f("topics", "Topics", "multiselect", { options: [...SECTORS, ...SKILLS] }),
      f("host", "Host / speaker", "text"),
    ],
  },
];

const RELATIONS = [
  { id: "MEMBER_OF", label: "member of", from: ["founder"], to: ["startup"] },
  { id: "ADVISES", label: "advises", from: ["mentor", "expert", "speaker"], to: ["startup"] },
  { id: "BACKS", label: "backs", from: ["investor", "organization"], to: ["startup"] },
  { id: "HOSTS", label: "hosts", from: ["organization", "partner"], to: ["workshop", "session"] },
];

async function main() {
  await post("/api/admin/apps", { slug: "summit", label: "Trusty Sevan", order: 1 });
  for (const t of TYPES) {
    await post("/api/admin/apps/summit/entity-types", t);
    console.log("  entity type:", t.id, `(${t.fields.length} fields)`);
  }
  for (const r of RELATIONS) {
    await post("/api/admin/apps/summit/relations", r);
    console.log("  relation:", r.id);
  }
  console.log("✅ Trusty Sevan app seeded");
}

main().catch((e) => { console.error("seed failed:", e.message); process.exit(1); });
