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
