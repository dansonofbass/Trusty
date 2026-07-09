/**
 * Trusty Sevan — match normalization + tag materialization (the hybrid model).
 * Run: npx tsx --test packages/graph-core/test/*.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  matchPct,
  materializeTags,
  whoToMeet,
  setCustomOntology,
  type Dataset,
  type GLink,
  type GNode,
} from "../src/index.ts";

/* A minimal summit-style app so entityTypeById resolves curated tag fields. */
setCustomOntology({
  apps: [{ slug: "test_summit", label: "Test Summit" }],
  entityTypes: [
    {
      app: "test_summit",
      id: "tfounder",
      label: "Test Founder",
      domain: "people",
      baseType: "person",
      topic: "founder",
      fields: [
        { key: "technologies", label: "Tech", type: "multiselect", options: ["react", "ai", "neo4j"] },
        { key: "needs", label: "Needs", type: "multiselect", options: ["funding", "engineers"] },
        { key: "bio", label: "Bio", type: "text" }, // free text — must NOT materialize
      ],
    },
    { app: "test_summit", id: "founder", label: "Founder", domain: "people", baseType: "person", topic: "founder", fields: [] },
    { app: "test_summit", id: "investor", label: "Investor", domain: "people", baseType: "person", topic: "investment", fields: [] },
    { app: "test_summit", id: "mentor", label: "Mentor", domain: "people", baseType: "person", topic: "mentorship", fields: [] },
    { app: "test_summit", id: "startup", label: "Startup", domain: "teams", baseType: "location", topic: "startup", fields: [] },
    { app: "test_summit", id: "workshop", label: "Workshop", domain: "programme", baseType: "location", topic: "workshop", fields: [] },
  ],
  relations: [],
});

const person = (props: Record<string, unknown>): GNode => ({
  id: "p1",
  type: "person",
  label: "Ana",
  clusters: [],
  entityType: "tfounder",
  properties: props,
});

const base = (props: Record<string, unknown>): Dataset => ({
  nodes: [person(props)],
  links: [],
  meId: "p1",
  recommendations: [],
});

test("matchPct: saturating bands (5→50, 15→75, 45→90, 0→0)", () => {
  assert.equal(matchPct(0), 0);
  assert.equal(matchPct(5), 50);
  assert.equal(matchPct(15), 75);
  assert.equal(matchPct(45), 90);
  assert.ok(matchPct(1000) < 100); // never a fake 100%
});

test("materializeTags: curated tags become shared concepts + typed edges", () => {
  const d = materializeTags(base({ technologies: ["react", "ai"], needs: ["funding"], bio: "loves react" }), "p1");
  const ids = d.nodes.map((n) => n.id);
  assert.ok(ids.includes("cn_t_react") && ids.includes("cn_t_ai") && ids.includes("cn_t_funding"));
  const uses = d.links.filter((l) => l.type === "USES").map((l) => l.target);
  assert.deepEqual(uses.sort(), ["cn_t_ai", "cn_t_react"]);
  assert.equal(d.links.filter((l) => l.type === "NEEDS").length, 1);
  // free-text field contributed nothing
  assert.equal(d.links.length, 3);
});

test("materializeTags: idempotent — re-running changes nothing", () => {
  const once = materializeTags(base({ technologies: ["react"] }), "p1");
  const twice = materializeTags(once, "p1");
  assert.equal(twice, once); // same object — no-op fast path
});

test("materializeTags: removing a tag drops its edge and prunes the orphan concept", () => {
  let d = materializeTags(base({ technologies: ["react", "ai"] }), "p1");
  // user removes "ai" from their profile
  d = {
    ...d,
    nodes: d.nodes.map((n) => (n.id === "p1" ? { ...n, properties: { technologies: ["react"] } } : n)),
  };
  d = materializeTags(d, "p1");
  assert.ok(!d.links.some((l) => l.id.includes("_ai")));
  assert.ok(!d.nodes.some((n) => n.id === "cn_t_ai")); // orphan pruned
  assert.ok(d.nodes.some((n) => n.id === "cn_t_react")); // survivor kept
});

test("materializeTags: non-curated values are ignored", () => {
  const d = materializeTags(base({ technologies: ["react", "cobol"] }), "p1");
  assert.ok(!d.nodes.some((n) => n.id === "cn_t_cobol"));
  assert.equal(d.links.length, 1);
});

test("materializeTags: no-op for nodes without an ontology type", () => {
  const d: Dataset = { nodes: [{ id: "x", type: "person", label: "X", clusters: [] }], links: [], meId: "x", recommendations: [] };
  assert.equal(materializeTags(d, "x"), d);
});

/* ------------------------- match engine v2 ------------------------- */

const P = (id: string, entityType: string, props: Record<string, unknown>, type: GNode["type"] = "person"): GNode =>
  ({ id, type, label: id, clusters: [], entityType, properties: props });

const engineFixture = (): { nodes: GNode[]; links: GLink[] } => ({
  nodes: [
    P("me", "founder", {
      technologies: ["react", "ai"], sectors: ["fintech"], markets: ["europe"],
      stage: "seed", needs: ["recommendation_api", "funding"], offers: ["payments_api"],
      skills_offered: ["growth"], skills_needed: ["engineering"], looking_for: ["investment"],
    }),
    P("api_guy", "founder", { offers: ["recommendation_api"], sectors: ["saas"] }),
    P("needy", "founder", { needs: ["payments_api"], sectors: ["ecommerce"] }),
    P("inv", "investor", { stages: ["seed", "series_a"], sectors: ["fintech"], markets: ["europe"] }),
    P("men", "mentor", { expertise: ["engineering"], industries: ["fintech"] }),
    P("distant", "founder", { sectors: ["gaming"] }),
    P("ws", "workshop", { topics: ["fintech", "growth"] }, "location"),
    P("stp", "startup", { needs: ["payments_api"], technologies: ["react"], sectors: ["fintech"] }, "location"),
  ],
  links: [
    { id: "a1", source: "me", target: "ws", type: "ATTENDING", weight: 1 },
    { id: "a2", source: "api_guy", target: "ws", type: "ATTENDING", weight: 1 },
    { id: "f1", source: "me", target: "distant", type: "FRIENDS_WITH", weight: 1 },
    { id: "f2", source: "distant", target: "needy", type: "FRIENDS_WITH", weight: 1 },
  ],
});

test("engine: need↔offer is the dominant signal and is explained", () => {
  const { nodes, links } = engineFixture();
  const recs = whoToMeet(nodes, links, "me");
  const top = recs[0];
  assert.equal(top.nodeId, "api_guy"); // offers the API I need + same workshop
  assert.ok(top.reasons.some((r) => r.includes("recommendation api")));
  assert.ok(top.reasons.some((r) => r.includes("same workshop")));
  assert.ok(top.matchPct >= 40, `expected good match, got ${top.matchPct}`);
});

test("engine: stage + sector + market compatibility scores investors", () => {
  const { nodes, links } = engineFixture();
  const recs = whoToMeet(nodes, links, "me", { mode: "investors" });
  assert.equal(recs.length, 1);
  assert.equal(recs[0].nodeId, "inv");
  assert.ok(recs[0].reasons.some((r) => r.includes("invests at seed")));
  assert.ok(recs[0].reasons.some((r) => r.includes("both in fintech")));
  assert.ok(recs[0].reasons.some((r) => r.includes("both targeting europe")));
});

test("engine: modes filter targets (mentors / workshops / needs_my_offer / api_customers)", () => {
  const { nodes, links } = engineFixture();
  assert.deepEqual(whoToMeet(nodes, links, "me", { mode: "mentors" }).map((r) => r.nodeId), ["men"]);
  const ws = whoToMeet(nodes, links, "me", { mode: "workshops" });
  assert.equal(ws[0]?.nodeId, "ws"); // covers fintech + growth
  const needy = whoToMeet(nodes, links, "me", { mode: "needs_my_offer" }).map((r) => r.nodeId);
  assert.ok(needy.includes("needy") && needy.includes("stp") && !needy.includes("inv"));
  const api = whoToMeet(nodes, links, "me", { mode: "api_customers" }).map((r) => r.nodeId);
  assert.ok(api.includes("needy") && api.includes("stp"));
});

test("engine: mutual connections beat 2nd-degree, workshops only count for persons", () => {
  const { nodes, links } = engineFixture();
  const recs = whoToMeet(nodes, links, "me");
  const needy = recs.find((r) => r.nodeId === "needy")!;
  assert.ok(needy.reasons.some((r) => r.includes("mutual connection") || r.includes("2nd-degree")));
});

test("engine: baseline keeps cold-start non-empty in people mode only", () => {
  const { nodes, links } = engineFixture();
  const all = whoToMeet(nodes, links, "me");
  assert.ok(all.some((r) => r.nodeId === "distant")); // gaming founder still listed…
  const partners = whoToMeet(nodes, links, "me", { mode: "partners" });
  assert.ok(!partners.some((r) => r.nodeId === "distant")); // …but not as a partner
});
