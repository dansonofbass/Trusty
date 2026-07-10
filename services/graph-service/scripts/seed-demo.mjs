/**
 * Seed DEMO DATA for both apps so you can test every flow on a fresh stack:
 *   • Global "Trusty" app — restaurants/cafés, people, friendships, trust edges.
 *   • "Trusty Sevan" summit app — the event ontology + attendees (profiles),
 *     startups, programme (workshops/sessions), attendance, and saved contacts.
 *
 * Pure REST against graph-service (auth is just the x-user-id header — first
 * sight of an id materialises that user). Idempotent: profiles/edges/trust
 * upsert, and entities are de-duped by label, so it's safe to re-run.
 *
 * Run inside the stack (graph-service reaches itself at localhost:4001):
 *   docker compose exec graph-service node scripts/seed-demo.mjs
 * Or from the host (port 4001 is published):
 *   SEED_BASE=http://localhost:4001 node services/graph-service/scripts/seed-demo.mjs
 */

const BASE = process.env.SEED_BASE ?? "http://localhost:4001";

async function req(method, path, { user = "seed-admin", name, app, body } = {}) {
  const headers = { "content-type": "application/json", "x-user-id": user };
  if (name) headers["x-user-name"] = encodeURIComponent(name);
  const url = BASE + path + (app ? (path.includes("?") ? "&" : "?") + "app=" + app : "");
  const r = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let j; try { j = JSON.parse(text); } catch { j = { raw: text.slice(0, 200) }; }
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
  return j;
}
const get = (p, o) => req("GET", p, o);
const post = (p, body, o = {}) => req("POST", p, { ...o, body });
const ensureUser = (user, name) => get("/api/profile", { user, name }); // materialises the person

/* =================================================================== */
/* 1. GLOBAL "Trusty" app — restaurants, people, friendships, trust      */
/* =================================================================== */

const RESTAURANTS = [
  { entityType: "restaurant", label: "Lavash", properties: { cuisine: ["armenian"], price_range: "$$", meal_types: ["lunch", "dinner"], good_for: ["date_night", "groups"], amenities: ["table_service", "outdoor_seating", "wifi", "accepts_cards", "serves_alcohol"], hours: "Mo-Su 11:00-24:00", address: "21 Tumanyan St", geo: "yerevan", capacity: 120 } },
  { entityType: "restaurant", label: "Sherep", properties: { cuisine: ["armenian"], price_range: "$$$", meal_types: ["lunch", "dinner"], good_for: ["business", "family"], amenities: ["table_service", "accepts_cards", "wine_beer", "air_conditioning"], hours: "Mo-Su 12:00-23:30", address: "1 Amiryan St", geo: "yerevan" } },
  { entityType: "restaurant", label: "Tumanyan Khinkali", properties: { cuisine: ["georgian"], price_range: "$$", meal_types: ["lunch", "dinner"], good_for: ["groups", "quick_bite"], amenities: ["takeaway", "accepts_cards"], hours: "Mo-Su 10:00-23:00", geo: "yerevan" } },
  { entityType: "restaurant", label: "Black Angus Grill", properties: { cuisine: ["steakhouse", "american"], price_range: "$$$", meal_types: ["dinner"], good_for: ["date_night", "business"], amenities: ["full_bar", "serves_alcohol", "table_service", "accepts_cards"], hours: "Mo-Su 13:00-00:00", geo: "yerevan" } },
  { entityType: "restaurant", label: "Dolmama", properties: { cuisine: ["armenian", "mediterranean"], price_range: "$$$$", meal_types: ["dinner"], good_for: ["date_night"], dietary: ["vegetarian"], amenities: ["table_service", "wine_beer", "outdoor_seating", "accepts_cards"], hours: "Mo-Su 12:00-23:00", address: "10 Pushkin St", geo: "yerevan", capacity: 60 } },
  { entityType: "restaurant", label: "Wine Republic", properties: { cuisine: ["european", "mediterranean"], price_range: "$$$", meal_types: ["dinner", "drinks"], good_for: ["date_night", "groups"], amenities: ["full_bar", "wine_beer", "live_music", "outdoor_seating", "accepts_cards"], hours: "Mo-Su 12:00-01:00", geo: "yerevan" } },
  { entityType: "cafe", label: "Green Bean", properties: { specialty: ["coffee", "brunch"], price_range: "$$", meal_types: ["breakfast", "brunch", "coffee"], wifi: true, laptop_friendly: true, amenities: ["wifi", "outdoor_seating", "accepts_cards"], hours: "Mo-Su 08:00-22:00", geo: "yerevan" } },
  { entityType: "cafe", label: "Coffeeshop Company", properties: { specialty: ["coffee", "desserts"], price_range: "$$", meal_types: ["coffee", "dessert"], wifi: true, amenities: ["wifi", "accepts_cards", "air_conditioning"], hours: "Mo-Su 09:00-23:00", geo: "yerevan" } },
];

// user → { name, trusts:[{place, reasons, note, confidence}], friends:[userIds] }
const PEOPLE = {
  aram: { name: "Aram Petrosyan", friends: ["nare", "david"], trusts: [
    { place: "Lavash", reasons: ["food_quality", "atmosphere"], note: "Best for out-of-town guests.", confidence: 0.9 },
    { place: "Black Angus Grill", reasons: ["food_quality", "service"], note: "Steaks are consistently great.", confidence: 0.85 } ] },
  nare: { name: "Nare Hakobyan", friends: ["aram", "lilit", "sona"], trusts: [
    { place: "Dolmama", reasons: ["food_quality", "atmosphere"], note: "Special-occasion favourite.", confidence: 0.95 },
    { place: "Green Bean", reasons: ["service", "atmosphere"], note: "My work-from-café spot.", confidence: 0.8 } ] },
  david: { name: "David Sargsyan", friends: ["aram", "tigran"], trusts: [
    { place: "Sherep", reasons: ["food_quality", "service"], note: "Great for business lunches.", confidence: 0.88 },
    { place: "Tumanyan Khinkali", reasons: ["price", "food_quality"], note: "Cheap and delicious khinkali.", confidence: 0.82 } ] },
  lilit: { name: "Lilit Grigoryan", friends: ["nare", "sona"], trusts: [
    { place: "Wine Republic", reasons: ["atmosphere", "service"], note: "Lovely wine list + terrace.", confidence: 0.87 },
    { place: "Lavash", reasons: ["food_quality"], note: "The lamb is amazing.", confidence: 0.8 } ] },
  sona: { name: "Sona Avetisyan", friends: ["nare", "lilit", "tigran"], trusts: [
    { place: "Coffeeshop Company", reasons: ["service", "cleanliness"], note: "Reliable coffee near the office.", confidence: 0.78 },
    { place: "Dolmama", reasons: ["food_quality"], note: "Worth it for a treat.", confidence: 0.86 } ] },
  tigran: { name: "Tigran Melkonyan", friends: ["david", "sona"], trusts: [
    { place: "Black Angus Grill", reasons: ["food_quality", "atmosphere"], note: "My go-to for celebrations.", confidence: 0.9 },
    { place: "Wine Republic", reasons: ["atmosphere"], note: "Great vibe on weekends.", confidence: 0.8 } ] },
};

async function seedGlobal() {
  console.log("\n🌍 Global app — restaurants, people, trust");
  // create restaurants (skip existing by label)
  const placesOf = async (topic) => (await get(`/api/places?topic=${topic}&limit=50`, { user: "seed-admin" })).places ?? [];
  const existing = new Set([...(await placesOf("restaurant")), ...(await placesOf("cafe"))].map((p) => p.label));
  for (const r of RESTAURANTS) {
    if (existing.has(r.label)) continue;
    await post("/api/entity", r, { user: "seed-admin" });
    console.log("  + place:", r.label);
  }
  // map label → nodeId (new + pre-existing)
  const all = [...(await placesOf("restaurant")), ...(await placesOf("cafe"))];
  const id = Object.fromEntries(all.map((p) => [p.label, p.nodeId]));

  // people, friendships, trust
  for (const [uid, u] of Object.entries(PEOPLE)) await ensureUser(uid, u.name);
  for (const [uid, u] of Object.entries(PEOPLE)) {
    for (const f of u.friends) await post("/api/edges", { source: uid, target: f }, { user: uid }); // FRIENDS_WITH (per-owner)
    for (const t of u.trusts) {
      if (!id[t.place]) continue;
      await post("/api/trust", { to: id[t.place], scope: { topic: "restaurant", geo: "yerevan" }, confidence: t.confidence, reasons: t.reasons, note: t.note }, { user: uid });
    }
  }
  console.log(`  ✓ ${Object.keys(PEOPLE).length} people, friendships + trust edges`);
}

/* =================================================================== */
/* 2. "Trusty Sevan" summit — ontology (identical to seed-summit.mjs)    */
/* =================================================================== */

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
const PERSON_COMMON = [
  f("headline", "Headline", "text", { placeholder: "one line about you" }),
  f("country", "Country", "select", { options: COUNTRIES }),
  f("technologies", "Technologies", "multiselect", { options: TECHNOLOGIES }),
  f("skills_offered", "Skills I offer", "multiselect", { options: SKILLS }),
  f("skills_needed", "Skills I need", "multiselect", { options: SKILLS }),
  f("interests", "Interests", "multiselect", { options: SECTORS }),
  f("needs", "Looking for (needs)", "multiselect", { options: NEED_OFFER }),
  f("offers", "Can help with (offers)", "multiselect", { options: NEED_OFFER }),
  f("can_help_with", "How I help", "text"),
  f("bio", "Short bio", "text"),
  f("website", "Website", "text"),
  f("linkedin", "LinkedIn", "text"),
];
const SUMMIT_TYPES = [
  { id: "founder", label: "Founder", baseType: "person", topic: "founder", category: "people", fields: [...PERSON_COMMON, f("sectors", "Sectors", "multiselect", { options: SECTORS }), f("stage", "Stage", "select", { options: STAGES }), f("looking_for", "Looking for", "multiselect", { options: LOOKING_FOR }), f("pathway", "Pathway", "select", { options: PATHWAY })] },
  { id: "mentor", label: "Mentor", baseType: "person", topic: "mentorship", category: "people", fields: [...PERSON_COMMON, f("expertise", "Expertise", "multiselect", { options: SKILLS }), f("industries", "Industries", "multiselect", { options: SECTORS }), f("availability", "Availability", "text")] },
  { id: "investor", label: "Investor", baseType: "person", topic: "investment", category: "people", fields: [...PERSON_COMMON, f("firm", "Firm", "text"), f("kind", "Kind", "select", { options: ["angel", "vc", "syndicate", "accelerator"] }), f("check_size", "Check size", "money", { unit: "USD" }), f("stages", "Stages", "multiselect", { options: STAGES }), f("sectors", "Sectors", "multiselect", { options: SECTORS }), f("markets", "Geo focus", "multiselect", { options: MARKETS }), f("thesis", "Thesis", "text")] },
  { id: "expert", label: "Expert", baseType: "person", topic: "mentorship", category: "people", fields: [...PERSON_COMMON, f("expertise", "Expertise", "multiselect", { options: SKILLS }), f("industries", "Industries", "multiselect", { options: SECTORS })] },
  { id: "speaker", label: "Speaker", baseType: "person", topic: "mentorship", category: "people", fields: [f("talk_topic", "Talk topic", "text"), f("org", "Organization", "text"), ...PERSON_COMMON] },
  { id: "startup", label: "Startup", baseType: "location", topic: "startup", category: "teams", fields: [f("one_liner", "One-liner", "text"), f("description", "Description", "text"), f("stage", "Stage", "select", { options: STAGES }), f("sectors", "Sectors", "multiselect", { options: SECTORS }), f("markets", "Target markets", "multiselect", { options: MARKETS }), f("business_model", "Business model", "select", { options: ["b2b", "b2c", "b2b2c", "marketplace", "api", "saas", "hardware"] }), f("technologies", "Technologies", "multiselect", { options: TECHNOLOGIES }), f("needs", "Needs", "multiselect", { options: NEED_OFFER }), f("offers", "Offers", "multiselect", { options: NEED_OFFER }), f("looking_for", "Looking for", "multiselect", { options: LOOKING_FOR }), f("open_positions", "Open positions", "multiselect", { options: SKILLS }), f("team_size", "Team size", "number"), f("raising", "Raising", "money", { unit: "USD" }), f("website", "Website", "text")] },
  { id: "organization", label: "Organization", baseType: "location", topic: "partner", category: "orgs", fields: [f("kind", "Kind", "select", { options: ["accelerator", "vc_firm", "corporate", "university", "ngo", "government", "media"] }), f("description", "Description", "text"), f("sectors", "Sectors", "multiselect", { options: SECTORS }), f("offers", "Offers", "multiselect", { options: NEED_OFFER }), f("website", "Website", "text")] },
  { id: "partner", label: "Partner", baseType: "location", topic: "partner", category: "orgs", fields: [f("kind", "Kind", "select", { options: ["sponsor", "ecosystem", "accelerator", "media", "government"] }), f("offer", "What they offer", "text"), f("sectors", "Sectors", "multiselect", { options: SECTORS }), f("website", "Website", "text")] },
  { id: "workshop", label: "Workshop", baseType: "location", topic: "workshop", category: "programme", fields: [f("description", "Description", "text"), f("track", "Track", "select", { options: TRACKS }), f("time", "Time", "text"), f("topics", "Topics", "multiselect", { options: [...SECTORS, ...SKILLS] }), f("host", "Host", "text")] },
  { id: "session", label: "Session", baseType: "location", topic: "workshop", category: "programme", fields: [f("description", "Description", "text"), f("track", "Track", "select", { options: TRACKS }), f("time", "Time", "text"), f("topics", "Topics", "multiselect", { options: [...SECTORS, ...SKILLS] }), f("host", "Host / speaker", "text")] },
];
const SUMMIT_RELATIONS = [
  { id: "MEMBER_OF", label: "member of", from: ["founder"], to: ["startup"] },
  { id: "ADVISES", label: "advises", from: ["mentor", "expert", "speaker"], to: ["startup"] },
  { id: "BACKS", label: "backs", from: ["investor", "organization"], to: ["startup"] },
  { id: "HOSTS", label: "hosts", from: ["organization", "partner"], to: ["workshop", "session"] },
];

async function seedSummitOntology() {
  console.log("\n🏔️  Trusty Sevan — ontology");
  await post("/api/admin/apps", { slug: "summit", label: "Trusty Sevan", order: 1 });
  for (const t of SUMMIT_TYPES) await post("/api/admin/apps/summit/entity-types", t);
  for (const r of SUMMIT_RELATIONS) await post("/api/admin/apps/summit/relations", r);
  console.log(`  ✓ app + ${SUMMIT_TYPES.length} entity types + ${SUMMIT_RELATIONS.length} relations`);
}

/* =================================================================== */
/* 3. "Trusty Sevan" summit — attendees, startups, programme, edges      */
/* =================================================================== */

// Profiles are crafted so need↔offer + tech/sector overlaps produce real matches.
const ATTENDEES = [
  { id: "sv_ani", name: "Ani Grigoryan", entityType: "founder", props: { headline: "Building AI invoicing for SMBs", country: "armenia", sectors: ["fintech", "ai"], stage: "seed", technologies: ["ai", "llm", "react", "node"], skills_needed: ["engineering", "design"], skills_offered: ["product", "growth"], needs: ["funding", "engineers", "pilot_customers"], offers: ["recommendation_api", "mentorship"], looking_for: ["investment", "hiring"], bio: "2x founder, ex-fintech PM." } },
  { id: "sv_davit", name: "Davit Petrosyan", entityType: "founder", props: { headline: "Healthtech data platform", country: "armenia", sectors: ["healthtech", "ai"], stage: "pre_seed", technologies: ["ml", "python", "aws"], skills_needed: ["design", "marketing"], skills_offered: ["engineering", "data"], needs: ["designers", "recommendation_api", "funding"], offers: ["api_integration", "data_api"], looking_for: ["cofounder", "investment"], bio: "PhD in ML, healthcare focus." } },
  { id: "sv_mariam", name: "Mariam Sahakyan", entityType: "founder", props: { headline: "Recommendation-as-a-service", country: "georgia", sectors: ["ai", "saas"], stage: "seed", technologies: ["llm", "python", "aws", "recommendation_systems"], skills_needed: ["sales", "marketing"], skills_offered: ["engineering", "data"], needs: ["pilot_customers", "cloud_credits", "sales_help"], offers: ["recommendation_api", "ai_api", "api_integration"], looking_for: ["pilot_customer", "hiring"], bio: "Ex-Big Tech recsys engineer." } },
  { id: "sv_gor", name: "Gor Manukyan", entityType: "founder", props: { headline: "B2B marketplace for logistics", country: "armenia", sectors: ["marketplace", "ecommerce"], stage: "idea", technologies: ["node", "react", "postgres"], skills_needed: ["engineering", "product"], skills_offered: ["sales", "ops"], needs: ["co_founder", "engineers", "funding"], offers: ["distribution", "sales_help"], looking_for: ["cofounder", "investment"], bio: "10y in logistics ops." } },
  { id: "sv_karen", name: "Karen Vardanyan", entityType: "mentor", props: { headline: "Scaling engineering teams", country: "usa", expertise: ["engineering", "product"], industries: ["ai", "fintech", "saas"], technologies: ["node", "kubernetes", "aws"], skills_offered: ["engineering", "product"], offers: ["mentorship", "engineers"], can_help_with: "Hiring, architecture, 0→1 product.", bio: "VP Eng, mentor at 3 accelerators." } },
  { id: "sv_lucine", name: "Lucine Harutyunyan", entityType: "expert", props: { headline: "Brand & growth design", country: "france", expertise: ["design", "marketing", "growth"], industries: ["consumer", "saas", "ecommerce"], skills_offered: ["design", "marketing"], offers: ["designers", "marketing_help"], can_help_with: "Brand, landing pages, growth loops.", bio: "Design lead, 50+ launches." } },
  { id: "sv_sarah", name: "Sarah Klein", entityType: "investor", props: { headline: "Angel — early fintech & AI", country: "germany", firm: "Klein Angels", kind: "angel", stages: ["pre_seed", "seed"], sectors: ["fintech", "ai", "saas"], markets: ["europe", "caucasus", "emerging_markets"], offers: ["funding", "investor_intros"], thesis: "Technical founders solving boring problems.", check_size: 75000 } },
  { id: "sv_raffi", name: "Raffi Terzian", entityType: "investor", props: { headline: "Seed VC, marketplaces & SaaS", country: "usa", firm: "Ararat Ventures", kind: "vc", stages: ["seed", "series_a"], sectors: ["saas", "marketplace", "ecommerce"], markets: ["global", "usa", "europe"], offers: ["funding", "distribution", "investor_intros"], thesis: "Category-defining marketplaces.", check_size: 500000 } },
  { id: "sv_nina", name: "Nina Abrahamyan", entityType: "expert", props: { headline: "Data engineering & MLOps", country: "netherlands", expertise: ["data", "engineering"], industries: ["ai", "healthtech", "deeptech"], technologies: ["python", "data_engineering", "aws"], skills_offered: ["data", "engineering"], offers: ["engineers", "data_api", "api_integration"], can_help_with: "Data pipelines, MLOps.", bio: "Staff data engineer." } },
  { id: "sv_vahe", name: "Vahe Adamyan", entityType: "speaker", props: { talk_topic: "Scaling AI startups in emerging markets", org: "TechCrunch", country: "armenia", technologies: ["ai", "llm"], skills_offered: ["growth", "product"], offers: ["mentorship", "investor_intros"], bio: "Journalist & operator." } },
  { id: "sv_elena", name: "Elena Ivanova", entityType: "founder", props: { headline: "Climate SaaS for supply chains", country: "estonia", sectors: ["climate", "saas"], stage: "seed", technologies: ["python", "react", "aws"], skills_needed: ["sales", "engineering"], skills_offered: ["product", "research"], needs: ["pilot_customers", "engineers", "distribution"], offers: ["data_api"], looking_for: ["pilot_customer", "partnership"], bio: "Ex-climate researcher." } },
  { id: "sv_hovhannes", name: "Hovhannes Khachatryan", entityType: "mentor", props: { headline: "GTM & sales for B2B", country: "uk", expertise: ["sales", "growth", "marketing"], industries: ["saas", "fintech", "marketplace"], skills_offered: ["sales", "growth"], offers: ["sales_help", "marketing_help", "distribution"], can_help_with: "Enterprise sales, pipeline.", bio: "CRO, 3 exits." } },
];

// startups + programme (created via /api/entity; de-duped by label)
const STARTUPS = [
  { label: "InvoiceAI", props: { one_liner: "AI invoicing for SMBs", stage: "seed", sectors: ["fintech", "ai"], markets: ["caucasus", "europe"], business_model: "saas", technologies: ["ai", "llm", "react"], needs: ["funding", "engineers"], offers: ["recommendation_api"], open_positions: ["engineering", "design"], team_size: 4, website: "https://invoice.ai" } },
  { label: "MediGraph", props: { one_liner: "Health data platform", stage: "pre_seed", sectors: ["healthtech", "ai"], markets: ["europe"], business_model: "b2b", technologies: ["ml", "python"], needs: ["designers", "funding"], offers: ["data_api", "api_integration"], open_positions: ["design"], team_size: 3 } },
  { label: "RecoStack", props: { one_liner: "Recommendations API", stage: "seed", sectors: ["ai", "saas"], markets: ["global"], business_model: "api", technologies: ["llm", "recommendation_systems"], needs: ["pilot_customers", "sales_help"], offers: ["recommendation_api", "ai_api"], team_size: 6 } },
  { label: "CargoNest", props: { one_liner: "Logistics marketplace", stage: "idea", sectors: ["marketplace", "ecommerce"], markets: ["armenia", "caucasus"], business_model: "marketplace", technologies: ["node", "react"], needs: ["co_founder", "engineers"], offers: ["distribution"], team_size: 2 } },
];
const PROGRAMME = [
  { entityType: "workshop", label: "Fundraising 101", props: { description: "How to raise your first round.", track: "pitch_tent", time: "Tue 15:00", topics: ["finance", "product"], host: "Sarah Klein" } },
  { entityType: "workshop", label: "Building with LLMs", props: { description: "Hands-on LLM app building.", track: "workshop_tent", time: "Tue 17:00", topics: ["ai", "engineering"], host: "Mariam Sahakyan" } },
  { entityType: "session", label: "Scaling in Emerging Markets", props: { description: "Fireside chat.", track: "main_stage", time: "Wed 19:00", topics: ["growth", "saas"], host: "Vahe Adamyan" } },
  { entityType: "session", label: "Lakeside Networking", props: { description: "Open networking by the lake.", track: "lakeside", time: "Wed 21:00", topics: ["community"], host: "Trusty Sevan" } },
];

async function seedSummitData() {
  console.log("\n🏔️  Trusty Sevan — attendees, startups, programme");
  for (const a of ATTENDEES) {
    await post("/api/profile", { entityType: a.entityType, label: a.name, properties: a.props }, { user: a.id, name: a.name });
  }
  console.log(`  ✓ ${ATTENDEES.length} attendee profiles`);

  // existing summit entities → de-dupe by label
  const dir = await get("/api/directory", { user: "seed-admin", app: "summit" });
  const idByLabel = Object.fromEntries((dir.nodes ?? []).map((n) => [n.label, n.id]));
  const ensureEntity = async (entityType, label, properties) => {
    if (idByLabel[label]) return idByLabel[label];
    const res = await post("/api/entity", { entityType, label, properties }, { user: "seed-admin" });
    const nid = res?._entity?.nodeId;
    if (nid) { idByLabel[label] = nid; console.log("  + entity:", label); }
    return nid;
  };
  for (const s of STARTUPS) await ensureEntity("startup", s.label, s.props);
  const workshopIds = [];
  for (const p of PROGRAMME) { const id = await ensureEntity(p.entityType, p.label, p.props); if (id) workshopIds.push(id); }

  // attendance (ATTENDING) — spread attendees across programme items
  const attend = [["sv_ani", 0], ["sv_ani", 2], ["sv_davit", 1], ["sv_mariam", 1], ["sv_mariam", 2], ["sv_gor", 0], ["sv_elena", 2], ["sv_karen", 1], ["sv_sarah", 0], ["sv_vahe", 2]];
  for (const [uid, i] of attend) if (workshopIds[i]) await post("/api/attend", { workshopId: workshopIds[i] }, { user: uid });

  // saved contacts (SAVED, lifecycle stages) — shows the pipeline + connect flow
  const saved = [
    ["sv_ani", "sv_sarah", "potential_investor", "met"],
    ["sv_davit", "sv_mariam", "potential_api_user", "conversation"],
    ["sv_gor", "sv_raffi", "potential_investor", "interested"],
    ["sv_ani", "sv_karen", "potential_mentor", "follow_up"],
    ["sv_mariam", "sv_elena", "potential_customer", "opportunity"],
  ];
  for (const [uid, target, label, stage] of saved) await post("/api/contacts", { targetId: target, label, stage }, { user: uid });
  console.log(`  ✓ ${workshopIds.length} programme items, attendance + saved contacts`);
}

/* =================================================================== */

async function main() {
  console.log(`Seeding demo data → ${BASE}`);
  await seedGlobal();
  await seedSummitOntology();
  await seedSummitData();
  console.log("\n✅ Done. Global app: /  ·  Summit app: /summit  ·  Admin: /admin");
}

main().catch((e) => { console.error("\n❌ seed failed:", e.message); process.exit(1); });
