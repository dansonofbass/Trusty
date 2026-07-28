/**
 * summitMatch — the Trusty Sevan Match engine. Answers "who should I meet next?"
 * (not "who should I trust?"): content/compatibility-based so it works with ZERO
 * trust edges — the event cold-start killer.
 *
 * Signals (each contributes weighted points + a human reason — every match is
 * explainable): need↔offer complementarity (incl. APIs — the strongest signal),
 * complementary skills, technology overlap, sector/industry/interest overlap,
 * target-market overlap, stage compatibility (investor↔founder/startup), shared
 * workshops/sessions (ATTENDING), mutual connections, role complementarity, and
 * network proximity. Raw scores normalize to a 0–100 Match % via a saturating
 * curve. Pure + deterministic.
 */
import type { GLink, GNode } from "./types";
import { appForEntityType } from "./ontologyRegistry";
import { hasRole } from "./ontology";

export interface MeetSuggestion {
  nodeId: string;
  score: number;
  /** Normalized 0–100 Match % (saturating — see matchPct). */
  matchPct: number;
  reasons: string[];
}

/** Which slice of the event graph to rank — powers the Home feed sections. */
export type MeetMode =
  | "people" // any profiled person (default)
  | "startups"
  | "mentors" // mentors + experts
  | "investors"
  | "workshops" // workshops + sessions
  | "skills_wanted" // people whose skills_needed ∩ my skills_offered
  | "needs_my_offer" // people/startups whose needs ∩ my offers
  | "partners" // startups complementary to me/my startup
  | "api_customers"; // people/startups needing an API I offer

export interface MeetOptions {
  app?: string;
  mode?: MeetMode;
  limit?: number;
  /** Free skill/tech query — boosts people offering it (Discover search). */
  skill?: string;
}

/**
 * Normalize a raw signal score to a 0–100 Match %. Saturating curve so a few
 * strong signals read high without ever hitting a fake 100%:
 * raw 5 → 50 · raw 15 → 75 · raw 45 → 90. Bands: ≥70 strong · 40–69 good.
 */
export function matchPct(raw: number): number {
  if (raw <= 0) return 0;
  return Math.min(99, Math.round((100 * raw) / (raw + 5)));
}

/* ------------------------------ helpers ------------------------------ */

const endId = (v: string | GNode): string => (typeof v === "string" ? v : v.id);
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v ? [String(v)] : []);
const intersect = (a: string[], b: string[]): string[] => {
  const set = new Set(b);
  return a.filter((x) => set.has(x));
};
const pretty = (s: string[]): string => s.map((x) => x.replace(/_/g, " ")).join(", ");
const isApi = (v: string) => v.endsWith("_api") || v === "api_integration";

/** Bidirectional acquaintance neighbors (FRIENDS_WITH + SAVED + MET_AT). */
function neighborsOf(links: GLink[], id: string): Set<string> {
  const out = new Set<string>();
  for (const l of links) {
    if (l.type !== "FRIENDS_WITH" && l.type !== "SAVED" && l.type !== "MET_AT") continue;
    const s = endId(l.source), t = endId(l.target);
    if (s === id) out.add(t);
    else if (t === id) out.add(s);
  }
  return out;
}

/** Workshop/session ids a person is ATTENDING. */
function attending(links: GLink[], id: string): Set<string> {
  const out = new Set<string>();
  for (const l of links) if (l.type === "ATTENDING" && endId(l.source) === id) out.add(endId(l.target));
  return out;
}

/** The squad node a person is MEMBER_OF (Seaside squads demo), if any. */
function squadOf(nodes: GNode[], links: GLink[], id: string): string | null {
  const squads = new Set(nodes.filter((n) => n.entityType === "squad").map((n) => n.id));
  for (const l of links) {
    if (l.type === "MEMBER_OF" && endId(l.source) === id && squads.has(endId(l.target))) {
      return endId(l.target);
    }
  }
  return null;
}

/* ------------------------------ the engine ------------------------------ */

export function whoToMeet(
  nodes: GNode[],
  links: GLink[],
  meId: string,
  opts: MeetOptions = {},
): MeetSuggestion[] {
  const mode: MeetMode = opts.mode ?? "people";
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const me = byId.get(meId);
  const mp = me?.properties ?? {};

  // My profile signals (viewer side). A founder's startup enriches the "me" side.
  const myStartup = links
    .filter((l) => l.type === "MEMBER_OF" && endId(l.source) === meId)
    .map((l) => byId.get(endId(l.target)))
    .find((n) => n?.entityType === "startup");
  const sp = myStartup?.properties ?? {};

  const myNeeded = arr(mp.skills_needed);
  const myOffered = arr(mp.skills_offered);
  const myNeeds = [...arr(mp.needs), ...arr(sp.needs)];
  const myOffers = [...arr(mp.offers), ...arr(sp.offers), ...arr(mp.apis), ...arr(sp.apis)];
  const myTech = [...arr(mp.technologies), ...arr(sp.technologies)];
  const mySectors = [...arr(mp.sectors), ...arr(mp.industries), ...arr(mp.interests), ...arr(sp.sectors)];
  const myMarkets = [...arr(mp.markets), ...arr(sp.markets)];
  const myStage = String(mp.stage ?? sp.stage ?? "");
  const myLookingFor = arr(mp.looking_for);
  const myApiOffers = myOffers.filter(isApi);

  const myFriends = neighborsOf(links, meId);
  const fof = new Set<string>();
  for (const f of myFriends) for (const n of neighborsOf(links, f)) if (n !== meId) fof.add(n);
  const myWorkshops = attending(links, meId);
  const mySquad = squadOf(nodes, links, meId);

  const wantSkill = opts.skill ? opts.skill.trim().toLowerCase().replace(/\s+/g, "_") : "";

  /** Per-mode target predicate — persons may act in MANY roles (active_roles). */
  const inMode = (n: GNode): boolean => {
    const et = n.entityType ?? "";
    switch (mode) {
      case "startups": return et === "startup";
      case "mentors": return hasRole(n, "mentor") || hasRole(n, "expert");
      case "investors": return hasRole(n, "investor");
      case "workshops": return et === "workshop" || et === "session";
      case "partners": return et === "startup";
      case "skills_wanted": return n.type === "person";
      case "needs_my_offer":
      case "api_customers": return n.type === "person" || et === "startup";
      default: return n.type === "person";
    }
  };

  const scored = nodes
    .filter(
      (n) =>
        n.id !== meId &&
        n.id !== myStartup?.id &&
        !!n.entityType &&
        (!opts.app || appForEntityType(n.entityType) === opts.app) &&
        inMode(n),
    )
    .map((n): MeetSuggestion => {
      const p = n.properties ?? {};
      const theirOffered = [...arr(p.skills_offered), ...arr(p.expertise)];
      const theirNeeded = arr(p.skills_needed);
      const theirNeeds = arr(p.needs);
      const theirOffers = [...arr(p.offers), ...arr(p.apis)];
      const theirTech = arr(p.technologies);
      const theirSectors = [...arr(p.sectors), ...arr(p.industries), ...arr(p.interests), ...arr(p.topics)];
      const theirMarkets = arr(p.markets);
      const reasons: string[] = [];
      let score = 0;

      // — need ↔ offer (the strongest signal; APIs weigh extra) —
      const theyProvide = intersect(myNeeds, theirOffers);
      if (theyProvide.length) {
        const apiHit = theyProvide.some(isApi);
        score += theyProvide.length * 4 + (apiHit ? 2 : 0);
        reasons.push(`offers the ${pretty(theyProvide.slice(0, 2))} you need`);
      }
      const iProvide = intersect(theirNeeds, myOffers);
      if (iProvide.length) {
        const apiHit = iProvide.some(isApi);
        score += iProvide.length * 3 + (apiHit ? 2 : 0);
        reasons.push(`needs your ${pretty(iProvide.slice(0, 2))}`);
      }

      // — complementary skills —
      const skillHit = intersect(myNeeded, theirOffered);
      if (skillHit.length) {
        score += 3 * skillHit.length;
        reasons.push(`can help with ${pretty(skillHit.slice(0, 2))}`);
      }
      const revSkill = intersect(theirNeeded, myOffered);
      if (revSkill.length) {
        score += 2 * revSkill.length;
        reasons.push(`looking for your ${pretty(revSkill.slice(0, 2))}`);
      }

      // — overlaps: technology · sector/industry/interest · market —
      const techHit = intersect(myTech, theirTech);
      if (techHit.length) {
        score += 1.5 * techHit.length;
        reasons.push(`both use ${pretty(techHit.slice(0, 2))}`);
      }
      const sectorHit = intersect(mySectors, theirSectors);
      if (sectorHit.length) {
        score += 1.5 * sectorHit.length;
        reasons.push(`both in ${pretty(sectorHit.slice(0, 2))}`);
      }
      const marketHit = intersect(myMarkets, theirMarkets);
      if (marketHit.length) {
        score += 1 * marketHit.length;
        reasons.push(`both targeting ${pretty(marketHit.slice(0, 2))}`);
      }

      // — stage compatibility (investor ↔ founder/startup, either direction) —
      const theirStages = arr(p.stages);
      const theirStage = String(p.stage ?? "");
      if (myStage && hasRole(n, "investor") && theirStages.includes(myStage)) {
        score += 2.5;
        reasons.push(`invests at ${myStage.replace(/_/g, " ")}`);
      } else if (me && hasRole(me, "investor") && theirStage && arr(mp.stages).includes(theirStage)) {
        score += 2.5;
        reasons.push(`${theirStage.replace(/_/g, " ")} — your stage`);
      } else if (myStage && theirStage && myStage === theirStage && !hasRole(n, "investor")) {
        score += 1;
        reasons.push("compatible stage");
      }

      // — same squad (Seaside demo): a strong, explicit tie —
      if (mySquad && n.type === "person" && squadOf(nodes, links, n.id) === mySquad) {
        score += 3;
        reasons.push("same squad");
      }

      // — shared workshops/sessions —
      if (myWorkshops.size && n.type === "person") {
        const shared = [...attending(links, n.id)].filter((w) => myWorkshops.has(w));
        if (shared.length) {
          score += 1.5 * shared.length;
          const w = byId.get(shared[0]);
          reasons.push(w ? `same workshop: ${w.label}` : "same workshop");
        }
      }

      // — workshops mode: score the workshop itself by topic fit —
      if (n.entityType === "workshop" || n.entityType === "session") {
        const topicHit = intersect([...mySectors, ...myOffered, ...myNeeded], theirSectors);
        if (topicHit.length) {
          score += 2 * topicHit.length;
          reasons.push(`covers ${pretty(topicHit.slice(0, 2))}`);
        }
      }

      // — role complementarity (any active role counts) —
      if (myLookingFor.includes("investment") && hasRole(n, "investor")) {
        score += 2.5;
        reasons.push("invests in startups like yours");
      }
      if (myLookingFor.includes("mentorship") && (hasRole(n, "mentor") || hasRole(n, "expert"))) {
        score += 2;
        reasons.push("mentors founders");
      }
      if (myLookingFor.includes("cofounder") && hasRole(n, "founder")) {
        score += 1.5;
        reasons.push("also a founder");
      }

      // — mutual connections + proximity —
      if (n.type === "person") {
        const mutual = [...neighborsOf(links, n.id)].filter((x) => myFriends.has(x) && x !== n.id).length;
        if (mutual > 0) {
          score += Math.min(3, mutual * 0.75);
          reasons.push(`${mutual} mutual connection${mutual > 1 ? "s" : ""}`);
        } else if (fof.has(n.id)) {
          score += 0.5;
          reasons.push("2nd-degree connection");
        }
      }

      // — explicit skill/tech search boost —
      if (wantSkill && [...theirOffered, ...theirTech, ...theirOffers].map((s) => s.toLowerCase()).includes(wantSkill)) {
        score += 5;
        reasons.push(`offers ${wantSkill.replace(/_/g, " ")}`);
      }

      // Mode gates: complementarity modes require their defining signal.
      if (mode === "skills_wanted" && revSkill.length === 0) score = 0;
      if (mode === "needs_my_offer" && iProvide.length === 0) score = 0;
      if (mode === "api_customers" && !theirNeeds.some((x) => myApiOffers.includes(x))) score = 0;
      if (mode === "partners" && theyProvide.length + iProvide.length + sectorHit.length + techHit.length === 0) score = 0;

      // Gentle baseline (default mode only) so a fresh attendee still sees people.
      if (score === 0 && mode === "people") {
        score = 0.2;
        reasons.push("at the event");
      }

      const rounded = Math.round(score * 100) / 100;
      return { nodeId: n.id, score: rounded, matchPct: matchPct(rounded), reasons: reasons.slice(0, 4) };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, opts.limit ?? 24);
}

/* ----------------------------- ranked search ----------------------------- */

const lc = (s: string): string => s.toLowerCase();
const slug = (v: unknown): string => String(v ?? "").toLowerCase().trim().replace(/\s+/g, "_");
const round2 = (n: number): number => Math.round(n * 100) / 100;

export interface SearchFilters {
  type?: string;
  industry?: string;
  tech?: string;
  country?: string;
  stage?: string;
  skill?: string;
}

export interface SearchOptions {
  app?: string;
  filters?: SearchFilters;
  /** Free-text query — matched against label, sub, and tag vocabularies. */
  q?: string;
  limit?: number;
}

export interface RankedHit {
  nodeId: string;
  score: number;
  matchPct: number;
  reasons: string[];
  /** Explainable factor breakdown (the three ranking channels). */
  factors: { relevance: number; affinity: number; proximity: number };
}

/**
 * Directory search that RANKS instead of merely filtering — recommendation-style.
 * Each candidate is scored on three channels, then sorted by their sum:
 *
 *  1. relevance   — how well it matches the query (facets + text tokens)
 *  2. affinity    — content compatibility with ME (need↔offer, skills, overlaps)
 *  3. proximity   — link prediction between me and the candidate: common
 *                   neighbours + the Adamic–Adar index (rare shared connections
 *                   count more), the classic edge-prediction signal.
 *
 * Hard constraints stay filters (app, explicit type/role, country); everything
 * else is a soft signal. Pure + deterministic; every hit carries its reasons.
 */
export function rankedSearch(
  nodes: GNode[],
  links: GLink[],
  meId: string,
  opts: SearchOptions = {},
): RankedHit[] {
  const { app, filters = {}, q = "", limit = 40 } = opts;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const me = byId.get(meId);
  const mp = me?.properties ?? {};

  // Viewer side — a founder's startup enriches "me".
  const myStartup = links
    .filter((l) => l.type === "MEMBER_OF" && endId(l.source) === meId)
    .map((l) => byId.get(endId(l.target)))
    .find((n) => n?.entityType === "startup");
  const sp = myStartup?.properties ?? {};
  const myNeeds = [...arr(mp.needs), ...arr(sp.needs)];
  const myOffers = [...arr(mp.offers), ...arr(sp.offers), ...arr(mp.apis), ...arr(sp.apis)];
  const myNeeded = arr(mp.skills_needed);
  const myOffered = arr(mp.skills_offered);
  const myTech = [...arr(mp.technologies), ...arr(sp.technologies)];
  const mySectors = [...arr(mp.sectors), ...arr(mp.industries), ...arr(mp.interests), ...arr(sp.sectors)];

  // Full-graph adjacency + degree — for common-neighbour / Adamic–Adar link prediction.
  const nbr = new Map<string, Set<string>>();
  const add = (a: string, b: string) => {
    let set = nbr.get(a);
    if (!set) { set = new Set(); nbr.set(a, set); }
    set.add(b);
  };
  for (const l of links) {
    const s = endId(l.source), t = endId(l.target);
    if (s === t) continue;
    add(s, t); add(t, s);
  }
  const deg = (id: string): number => nbr.get(id)?.size ?? 0;
  const myNbrs = nbr.get(meId) ?? new Set<string>();
  const socialFriends = neighborsOf(links, meId);

  const qTokens = lc(q).split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
  const wantType = filters.type;
  const wantCountry = filters.country ? slug(filters.country) : "";
  const hasQuery =
    qTokens.length > 0 ||
    !!(filters.type || filters.industry || filters.tech || filters.country || filters.stage || filters.skill);

  const hits = nodes
    .filter(
      (n) =>
        n.id !== meId &&
        n.id !== myStartup?.id &&
        !!n.entityType &&
        (!app || appForEntityType(n.entityType) === app) &&
        (!wantType || n.entityType === wantType || hasRole(n, wantType)) &&
        (!wantCountry || slug((n.properties ?? {}).country) === wantCountry),
    )
    .map((n) => {
      const p = n.properties ?? {};
      const theirSectors = [...arr(p.sectors), ...arr(p.industries), ...arr(p.interests), ...arr(p.topics)];
      const theirTech = arr(p.technologies);
      const theirOffered = [...arr(p.skills_offered), ...arr(p.expertise)];
      const theirOffers = [...arr(p.offers), ...arr(p.apis)];
      const theirNeeds = arr(p.needs);
      const theirNeeded = arr(p.skills_needed);
      const reasons: string[] = [];

      // 1 — relevance to the query (facets + free-text tokens)
      let rel = 0;
      if (filters.industry && theirSectors.map(lc).includes(slug(filters.industry))) {
        rel += 3; reasons.push(`in ${filters.industry.replace(/_/g, " ")}`);
      }
      if (filters.tech && theirTech.map(lc).includes(slug(filters.tech))) {
        rel += 3; reasons.push(`uses ${filters.tech.replace(/_/g, " ")}`);
      }
      if (filters.stage && slug(p.stage) === slug(filters.stage)) {
        rel += 2; reasons.push(`${filters.stage.replace(/_/g, " ")} stage`);
      }
      if (filters.skill && [...theirOffered, ...theirOffers].map(lc).includes(slug(filters.skill))) {
        rel += 3; reasons.push(`offers ${filters.skill.replace(/_/g, " ")}`);
      }
      if (qTokens.length) {
        const roles = arr((p as { active_roles?: unknown }).active_roles);
        const hay = lc([n.label, n.sub ?? "", n.entityType ?? "", ...roles, ...theirSectors, ...theirTech, ...theirOffered, ...theirOffers].join(" "));
        const hitN = qTokens.filter((t) => hay.includes(t)).length;
        if (hitN) rel += 2 * hitN;
      }

      // 2 — affinity to me (content compatibility)
      let aff = 0;
      const theyProvide = intersect(myNeeds, theirOffers);
      if (theyProvide.length) {
        aff += theyProvide.length * 4 + (theyProvide.some(isApi) ? 2 : 0);
        reasons.push(`offers the ${pretty(theyProvide.slice(0, 2))} you need`);
      }
      const iProvide = intersect(theirNeeds, myOffers);
      if (iProvide.length) { aff += iProvide.length * 3; reasons.push(`needs your ${pretty(iProvide.slice(0, 2))}`); }
      const skillHit = intersect(myNeeded, theirOffered);
      if (skillHit.length) { aff += 3 * skillHit.length; reasons.push(`can help with ${pretty(skillHit.slice(0, 2))}`); }
      const techHit = intersect(myTech, theirTech);
      if (techHit.length) { aff += 1.5 * techHit.length; reasons.push(`both use ${pretty(techHit.slice(0, 2))}`); }
      const sectorHit = intersect(mySectors, theirSectors);
      if (sectorHit.length) { aff += 1.5 * sectorHit.length; reasons.push(`both in ${pretty(sectorHit.slice(0, 2))}`); }

      // 3 — link prediction (common neighbours + Adamic–Adar)
      let prox = 0;
      const common = [...(nbr.get(n.id) ?? [])].filter((x) => x !== meId && myNbrs.has(x));
      if (common.length) {
        const aa = common.reduce((sum, x) => sum + 1 / Math.log(2 + deg(x)), 0);
        prox += 1.2 * aa + 0.3 * common.length;
        const mutualPeople = common.filter((x) => byId.get(x)?.type === "person" && socialFriends.has(x));
        if (mutualPeople.length) {
          const names = mutualPeople.slice(0, 2).map((x) => byId.get(x)!.label);
          reasons.push(`${mutualPeople.length} mutual connection${mutualPeople.length > 1 ? "s" : ""} (via ${names.join(", ")})`);
        } else {
          reasons.push(`${common.length} shared connection${common.length > 1 ? "s" : ""}`);
        }
      }

      // Relevance leads (it's a search), affinity + link-prediction re-rank within.
      const raw = rel * 1.5 + aff + prox;
      return { n, rel, aff, prox, raw, reasons };
    })
    // With a query, require a positive signal; when browsing, keep anyone I have
    // any affinity/proximity to (so the directory is personalized, not random).
    .filter((h) => (hasQuery ? h.raw > 0 : h.aff + h.prox > 0))
    .sort((a, b) => b.raw - a.raw)
    .slice(0, limit)
    .map((h): RankedHit => ({
      nodeId: h.n.id,
      score: round2(h.raw),
      matchPct: matchPct(h.raw),
      reasons: h.reasons.slice(0, 4),
      factors: { relevance: round2(h.rel), affinity: round2(h.aff), proximity: round2(h.prox) },
    }));

  return hits;
}
