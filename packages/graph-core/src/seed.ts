import {
  Dataset,
  EDGE_VERB_FOR_TYPE,
  GLink,
  GNode,
  NodeType,
  TasteCluster,
} from "./types";
import { mulberry32, shuffle } from "./random";
import { computeRecommendations, recomputeVals } from "./recommend";
import { STARTING_BALANCE } from "./economy";

/* ------------------------------------------------------------------ */
/* Curated world                                                       */
/* ------------------------------------------------------------------ */

type PersonSpec = {
  name: string;
  clusters: TasteCluster[]; // first = primary
  friendOfMe?: boolean;
};

const CLUSTER_LABEL: Record<TasteCluster, string> = {
  tech_ai: "AI & tech",
  cinema: "Cinema",
  persian_culture: "Persian culture",
  finance: "Markets & finance",
  indie_music: "Indie music",
  travel: "Travel",
  food: "Food & dining",
};

const PEOPLE: PersonSpec[] = [
  { name: "Sara", clusters: ["tech_ai", "indie_music"], friendOfMe: true },
  { name: "Arman", clusters: ["finance", "tech_ai"], friendOfMe: true },
  { name: "Niloofar", clusters: ["persian_culture", "cinema"], friendOfMe: true },
  { name: "Reza", clusters: ["tech_ai", "finance"], friendOfMe: true },
  { name: "Kimia", clusters: ["cinema", "travel"], friendOfMe: true },
  { name: "Dariush", clusters: ["persian_culture", "indie_music"], friendOfMe: true },
  { name: "Leila", clusters: ["travel", "persian_culture"], friendOfMe: true },
  { name: "Omid", clusters: ["finance"], friendOfMe: true },
  { name: "Yasmin", clusters: ["indie_music", "cinema"], friendOfMe: true },
  { name: "Babak", clusters: ["tech_ai"], friendOfMe: true },
  { name: "Shirin", clusters: ["cinema", "persian_culture"], friendOfMe: true },
  { name: "Kaveh", clusters: ["travel", "finance"], friendOfMe: true },
  { name: "Parisa", clusters: ["indie_music", "travel"], friendOfMe: true },
  { name: "Tara", clusters: ["tech_ai", "cinema"], friendOfMe: true },
  { name: "Emma", clusters: ["indie_music"], friendOfMe: true },
  { name: "Lucas", clusters: ["finance", "travel"], friendOfMe: true },
  { name: "Yuki", clusters: ["cinema", "tech_ai"], friendOfMe: true },
  { name: "Priya", clusters: ["tech_ai", "travel"], friendOfMe: true },
  // Second-degree orbit — friends of friends
  { name: "Hossein", clusters: ["persian_culture", "finance"] },
  { name: "Marco", clusters: ["travel", "cinema"] },
  { name: "Amelie", clusters: ["cinema", "indie_music"] },
  { name: "Noah", clusters: ["tech_ai", "finance"] },
  { name: "Hanna", clusters: ["indie_music", "travel"] },
  { name: "Diego", clusters: ["travel"] },
  { name: "Lena", clusters: ["finance", "cinema"] },
  { name: "Tom", clusters: ["tech_ai"] },
  { name: "Zoe", clusters: ["indie_music", "persian_culture"] },
  { name: "Aiden", clusters: ["finance", "tech_ai"] },
  { name: "Mina", clusters: ["persian_culture", "travel"] },
  { name: "Farid", clusters: ["tech_ai", "indie_music"] },
  { name: "Setareh", clusters: ["cinema", "persian_culture"] },
  { name: "Jonas", clusters: ["finance", "travel"] },
  { name: "Roya", clusters: ["persian_culture", "indie_music"] },
];

type ContentSpec = { label: string; sub: string; clusters: TasteCluster[] };

const BOOKS: ContentSpec[] = [
  { label: "Sapiens", sub: "Yuval Noah Harari", clusters: ["tech_ai", "travel"] },
  { label: "Deep Learning", sub: "Goodfellow, Bengio & Courville", clusters: ["tech_ai"] },
  { label: "Zero to One", sub: "Peter Thiel", clusters: ["tech_ai", "finance"] },
  { label: "The Psychology of Money", sub: "Morgan Housel", clusters: ["finance"] },
  { label: "Thinking, Fast and Slow", sub: "Daniel Kahneman", clusters: ["finance", "tech_ai"] },
  { label: "بوف کور · The Blind Owl", sub: "Sadegh Hedayat", clusters: ["persian_culture"] },
  { label: "سووشون · Savushun", sub: "Simin Daneshvar", clusters: ["persian_culture"] },
  { label: "مثنوی معنوی · Masnavi", sub: "Rumi", clusters: ["persian_culture"] },
  { label: "Norwegian Wood", sub: "Haruki Murakami", clusters: ["indie_music", "cinema"] },
  { label: "Kafka on the Shore", sub: "Haruki Murakami", clusters: ["indie_music"] },
  { label: "Dune", sub: "Frank Herbert", clusters: ["cinema", "tech_ai"] },
  { label: "The Almanack of Naval Ravikant", sub: "Eric Jorgenson", clusters: ["finance", "tech_ai"] },
  { label: "Atomic Habits", sub: "James Clear", clusters: ["finance", "travel"] },
  { label: "The Lean Startup", sub: "Eric Ries", clusters: ["tech_ai"] },
  { label: "On the Road", sub: "Jack Kerouac", clusters: ["travel", "indie_music"] },
  { label: "Invisible Cities", sub: "Italo Calvino", clusters: ["travel", "cinema"] },
];

const NEWS: ContentSpec[] = [
  { label: "EU finalises AI Act enforcement rules", sub: "Reuters · Tech", clusters: ["tech_ai"] },
  { label: "Frontier lab unveils multimodal agent model", sub: "The Verge", clusters: ["tech_ai"] },
  { label: "Bitcoin ETF inflows hit quarterly record", sub: "Bloomberg", clusters: ["finance"] },
  { label: "Fed signals slower path on rates", sub: "FT · Markets", clusters: ["finance"] },
  { label: "Cannes 2026 lineup announced", sub: "Variety", clusters: ["cinema"] },
  { label: "Restored Kiarostami prints tour Europe", sub: "Sight & Sound", clusters: ["cinema", "persian_culture"] },
  { label: "Nowruz celebrations span 12 time zones", sub: "BBC Culture", clusters: ["persian_culture", "travel"] },
  { label: "Tehran Symphony opens spring season", sub: "Tehran Times", clusters: ["persian_culture", "indie_music"] },
  { label: "Vinyl outsells CDs for third year", sub: "Pitchfork", clusters: ["indie_music"] },
  { label: "Night trains return across Europe", sub: "The Guardian · Travel", clusters: ["travel"] },
  { label: "Schiphol–Amsterdam rail link expands", sub: "NL Times", clusters: ["travel"] },
  { label: "Chip exports reshape AI supply chains", sub: "Reuters · Semis", clusters: ["tech_ai", "finance"] },
];

const MUSIC: ContentSpec[] = [
  { label: "Homayoun Shajarian", sub: "Artist · Persian classical", clusters: ["persian_culture"] },
  { label: "Mohsen Namjoo", sub: "Artist · Persian fusion", clusters: ["persian_culture", "indie_music"] },
  { label: "Googoosh", sub: "Artist · Persian pop", clusters: ["persian_culture"] },
  { label: "Radiohead", sub: "Artist · Alt rock", clusters: ["indie_music"] },
  { label: "Tame Impala", sub: "Artist · Psych pop", clusters: ["indie_music"] },
  { label: "Bon Iver", sub: "Artist · Indie folk", clusters: ["indie_music"] },
  { label: "Khruangbin", sub: "Artist · Global funk", clusters: ["indie_music", "travel"] },
  { label: "Hans Zimmer", sub: "Composer · Film scores", clusters: ["cinema"] },
  { label: "Ludovico Einaudi", sub: "Composer · Modern classical", clusters: ["cinema", "indie_music"] },
  { label: "Daft Punk", sub: "Artist · Electronic", clusters: ["indie_music", "tech_ai"] },
  { label: "Kiosk", sub: "Artist · Persian rock", clusters: ["persian_culture", "indie_music"] },
  { label: "Sevdaliza", sub: "Artist · Alt R&B", clusters: ["indie_music", "persian_culture"] },
  { label: "Nils Frahm", sub: "Artist · Ambient piano", clusters: ["indie_music"] },
  { label: "Erik Satie", sub: "Composer · Minimalism", clusters: ["cinema", "indie_music"] },
];

const VIDEOS: ContentSpec[] = [
  { label: "But what is a neural network?", sub: "YouTube · 3Blue1Brown", clusters: ["tech_ai"] },
  { label: "The map of machine learning", sub: "YouTube · Veritasium", clusters: ["tech_ai"] },
  { label: "Attention is all you need — explained", sub: "YouTube · Yannic Kilcher", clusters: ["tech_ai"] },
  { label: "Lex Fridman #441 · AGI timelines", sub: "YouTube · Podcast", clusters: ["tech_ai"] },
  { label: "How Pixar lights a shot", sub: "YouTube · Insider Film", clusters: ["cinema"] },
  { label: "Every frame a painting: Kurosawa", sub: "YouTube · Video essay", clusters: ["cinema"] },
  { label: "Tehran street food tour", sub: "YouTube · Travel vlog", clusters: ["persian_culture", "travel"] },
  { label: "36 hours in Tokyo", sub: "YouTube · Travel film", clusters: ["travel"] },
  { label: "Persian calligraphy masterclass", sub: "YouTube · Honar", clusters: ["persian_culture"] },
  { label: "How ETFs actually work", sub: "YouTube · Two Cents", clusters: ["finance"] },
  { label: "The market cycle, visualized", sub: "YouTube · Finance explainer", clusters: ["finance"] },
  { label: "Tiny Desk: Khruangbin", sub: "YouTube · NPR Music", clusters: ["indie_music"] },
  { label: "Inside a vinyl pressing plant", sub: "YouTube · Documentary", clusters: ["indie_music"] },
  { label: "Why night trains are back", sub: "YouTube · Wendover", clusters: ["travel"] },
];

const ACCOUNTS: ContentSpec[] = [
  { label: "@AndrewYNg", sub: "X · 1.9M followers", clusters: ["tech_ai"] },
  { label: "@huggingface", sub: "X · AI community", clusters: ["tech_ai"] },
  { label: "@A24", sub: "Instagram · Film studio", clusters: ["cinema"] },
  { label: "@criterioncollection", sub: "Instagram · Cinema", clusters: ["cinema"] },
  { label: "@honargardi", sub: "Instagram · Persian art", clusters: ["persian_culture"] },
  { label: "@tehran.gallery", sub: "Instagram · Art scene", clusters: ["persian_culture"] },
  { label: "@WSJmarkets", sub: "X · Markets desk", clusters: ["finance"] },
  { label: "@FarnamStreet", sub: "X · Decision making", clusters: ["finance", "tech_ai"] },
  { label: "@pitchfork", sub: "Instagram · Music", clusters: ["indie_music"] },
  { label: "@boilerroomtv", sub: "Instagram · Live sets", clusters: ["indie_music"] },
  { label: "@NatGeoTravel", sub: "Instagram · Travel", clusters: ["travel"] },
  { label: "@accidentallywesanderson", sub: "Instagram · Places", clusters: ["travel", "cinema"] },
];

const MOVIES: ContentSpec[] = [
  { label: "A Separation · جدایی نادر از سیمین", sub: "Asghar Farhadi · 2011", clusters: ["persian_culture", "cinema"] },
  { label: "Taste of Cherry · طعم گیلاس", sub: "Abbas Kiarostami · 1997", clusters: ["persian_culture", "cinema"] },
  { label: "Children of Heaven · بچه‌های آسمان", sub: "Majid Majidi · 1997", clusters: ["persian_culture", "cinema"] },
  { label: "The Salesman · فروشنده", sub: "Asghar Farhadi · 2016", clusters: ["persian_culture", "cinema"] },
  { label: "Inception", sub: "Christopher Nolan · 2010", clusters: ["cinema", "tech_ai"] },
  { label: "Interstellar", sub: "Christopher Nolan · 2014", clusters: ["cinema", "tech_ai"] },
  { label: "Her", sub: "Spike Jonze · 2013", clusters: ["tech_ai", "cinema"] },
  { label: "Parasite", sub: "Bong Joon-ho · 2019", clusters: ["cinema"] },
  { label: "Spirited Away", sub: "Hayao Miyazaki · 2001", clusters: ["cinema", "travel"] },
  { label: "The Big Short", sub: "Adam McKay · 2015", clusters: ["finance", "cinema"] },
  { label: "Margin Call", sub: "J.C. Chandor · 2011", clusters: ["finance"] },
  { label: "Whiplash", sub: "Damien Chazelle · 2014", clusters: ["indie_music", "cinema"] },
  { label: "Amélie", sub: "Jean-Pierre Jeunet · 2001", clusters: ["cinema", "travel"] },
  { label: "Lost in Translation", sub: "Sofia Coppola · 2003", clusters: ["travel", "cinema"] },
];

const SIGNALS: ContentSpec[] = [
  { label: "BTC / USD", sub: "Crypto · spot", clusters: ["finance", "tech_ai"] },
  { label: "ETH / USD", sub: "Crypto · spot", clusters: ["finance", "tech_ai"] },
  { label: "NVDA", sub: "Equity · Nasdaq", clusters: ["finance", "tech_ai"] },
  { label: "S&P 500", sub: "Index · US", clusters: ["finance"] },
  { label: "Gold · XAU", sub: "Commodity", clusters: ["finance"] },
  { label: "USD / IRR", sub: "FX · open market", clusters: ["finance", "persian_culture"] },
  { label: "EUR / USD", sub: "FX · majors", clusters: ["finance"] },
  { label: "US 10Y Yield", sub: "Rates", clusters: ["finance"] },
  { label: "TSLA", sub: "Equity · Nasdaq", clusters: ["finance", "tech_ai"] },
  { label: "AAPL", sub: "Equity · Nasdaq", clusters: ["finance"] },
  { label: "Brent Crude", sub: "Commodity · energy", clusters: ["finance"] },
  { label: "Tehran TEDPIX", sub: "Index · TSE", clusters: ["finance", "persian_culture"] },
];

const LOCATIONS: ContentSpec[] = [
  { label: "Amsterdam · Canal Ring", sub: "Netherlands", clusters: ["travel"] },
  { label: "Café de Jaren", sub: "Amsterdam · café", clusters: ["travel", "finance"] },
  { label: "Tajrish Bazaar · بازار تجریش", sub: "Tehran", clusters: ["persian_culture", "travel"] },
  { label: "Darband Trail · دربند", sub: "Tehran · hiking", clusters: ["persian_culture", "travel"] },
  { label: "Tokyo · Shibuya", sub: "Japan", clusters: ["travel", "cinema"] },
  { label: "Lisbon · Alfama", sub: "Portugal", clusters: ["travel", "indie_music"] },
  { label: "Istanbul · Kadıköy", sub: "Türkiye", clusters: ["travel", "persian_culture"] },
  { label: "Berlin · Kreuzberg", sub: "Germany", clusters: ["travel", "indie_music"] },
  { label: "Kish Island · کیش", sub: "Persian Gulf", clusters: ["persian_culture", "travel"] },
  { label: "Paris · Le Marais", sub: "France", clusters: ["travel", "cinema"] },
  { label: "Bali · Ubud", sub: "Indonesia", clusters: ["travel"] },
  { label: "New York · MoMA", sub: "USA · museum", clusters: ["travel", "cinema"] },
  { label: "Isfahan · Naqsh-e Jahan", sub: "Iran · UNESCO", clusters: ["persian_culture", "travel"] },
  { label: "Kyoto · Arashiyama", sub: "Japan", clusters: ["travel"] },
];

/** Posts are authored by a person (by name) or an account (by handle). */
type PostSpec = { label: string; author: string; clusters: TasteCluster[] };

const POSTS: PostSpec[] = [
  { label: "Sunset over Darband — worth every step 🌄", author: "Leila", clusters: ["persian_culture", "travel"] },
  { label: "Fine-tuned a 7B model on my 3090 tonight", author: "Sara", clusters: ["tech_ai"] },
  { label: "Yalda table at my grandmother's ❤️ شب یلدا", author: "Niloofar", clusters: ["persian_culture"] },
  { label: "Reading Housel again. Wealth is what you don't see.", author: "Omid", clusters: ["finance"] },
  { label: "Vinyl haul: Khruangbin + Bon Iver", author: "Yasmin", clusters: ["indie_music"] },
  { label: "Night train Amsterdam → Vienna. No notes.", author: "Kaveh", clusters: ["travel"] },
  { label: "Kurosawa retrospective, day 3. Transcendent.", author: "Shirin", clusters: ["cinema"] },
  { label: "BTC funding rates look stretched here", author: "Arman", clusters: ["finance"] },
  { label: "Setar practice, week 12 🎵 سه‌تار", author: "Dariush", clusters: ["persian_culture", "indie_music"] },
  { label: "Shipped our agent eval pipeline 🚀", author: "Babak", clusters: ["tech_ai"] },
  { label: "First look: untitled A24 sci-fi", author: "@A24", clusters: ["cinema"] },
  { label: "Open weights drop: new multilingual model", author: "@huggingface", clusters: ["tech_ai"] },
  { label: "Restored 4K: Taste of Cherry stills", author: "@criterioncollection", clusters: ["cinema", "persian_culture"] },
  { label: "Calligraphy of Hafez, ink on gold", author: "@honargardi", clusters: ["persian_culture"] },
  { label: "Boiler Room x Tbilisi — full set", author: "@boilerroomtv", clusters: ["indie_music"] },
  { label: "10 windows over the Bosphorus", author: "@accidentallywesanderson", clusters: ["travel", "cinema"] },
  { label: "Q2 positioning: rates vs. growth", author: "@WSJmarkets", clusters: ["finance"] },
  { label: "Hidden tea houses of Isfahan 🍵", author: "@NatGeoTravel", clusters: ["travel", "persian_culture"] },
];

/* ------------------------------------------------------------------ */
/* Generation                                                          */
/* ------------------------------------------------------------------ */

const ME_CLUSTERS: TasteCluster[] = ["tech_ai", "indie_music", "persian_culture"];

function overlap(a: TasteCluster[], b: TasteCluster[]): number {
  let n = 0;
  for (const c of a) if (b.includes(c)) n += a[0] === c || b[0] === c ? 2 : 1;
  return n;
}

export function buildDataset(seed = 2026): Dataset {
  const rng = mulberry32(seed);
  const nodes: GNode[] = [];
  const links: GLink[] = [];
  let edgeN = 0;

  const addLink = (source: string, target: string, type: GLink["type"], weight = 1) => {
    links.push({ id: `e${edgeN++}`, source, target, type, weight });
  };

  // --- Seed persona -------------------------------------------------
  // A demo explorer that anchors the seed world. In multi-user mode this is
  // just another person to discover — NOT the viewer (each real user is their
  // own root). Labeled distinctly so it's never confused with "you".
  const ME: GNode = {
    id: "me",
    type: "person",
    label: "Aria (demo)",
    sub: "Seed explorer",
    clusters: ME_CLUSTERS,
  };
  nodes.push(ME);

  // --- People -------------------------------------------------------
  const personByName = new Map<string, GNode>();
  PEOPLE.forEach((p, i) => {
    const node: GNode = {
      id: `p${i + 1}`,
      type: "person",
      label: p.name,
      sub: CLUSTER_LABEL[p.clusters[0]],
      clusters: p.clusters,
    };
    nodes.push(node);
    personByName.set(p.name, node);
    if (p.friendOfMe) addLink("me", node.id, "FRIENDS_WITH", 2);
  });
  const people = PEOPLE.map((p, i) => ({ spec: p, node: nodes[i + 1] }));

  // Friend ↔ friend edges, denser inside shared taste clusters.
  for (let i = 0; i < people.length; i++) {
    for (let j = i + 1; j < people.length; j++) {
      const a = people[i];
      const b = people[j];
      const shared = overlap(a.spec.clusters, b.spec.clusters);
      const samePrimary = a.spec.clusters[0] === b.spec.clusters[0];
      const p = samePrimary ? 0.5 : shared > 0 ? 0.16 : 0.035;
      if (rng() < p) addLink(a.node.id, b.node.id, "FRIENDS_WITH", samePrimary ? 2 : 1);
    }
  }
  // Guarantee every second-degree person touches at least one of my friends.
  const myFriendIds = new Set(
    links.filter((l) => l.type === "FRIENDS_WITH" && l.source === "me").map((l) => l.target as string),
  );
  for (const { spec, node } of people) {
    if (spec.friendOfMe) continue;
    const touchesFriend = links.some(
      (l) =>
        l.type === "FRIENDS_WITH" &&
        ((l.source === node.id && myFriendIds.has(l.target as string)) ||
          (l.target === node.id && myFriendIds.has(l.source as string))),
    );
    if (!touchesFriend) {
      const candidates = people.filter(
        (q) => q.spec.friendOfMe && overlap(q.spec.clusters, spec.clusters) > 0,
      );
      const pickFrom = candidates.length ? candidates : people.filter((q) => q.spec.friendOfMe);
      const f = pickFrom[Math.floor(rng() * pickFrom.length)];
      addLink(node.id, f.node.id, "FRIENDS_WITH", 1);
    }
  }

  // --- Content nodes -------------------------------------------------
  const catalog: Array<{ prefix: string; type: NodeType; items: ContentSpec[] }> = [
    { prefix: "b", type: "book", items: BOOKS },
    { prefix: "n", type: "news", items: NEWS },
    { prefix: "m", type: "music", items: MUSIC },
    { prefix: "v", type: "video", items: VIDEOS },
    { prefix: "a", type: "social_account", items: ACCOUNTS },
    { prefix: "mv", type: "movie", items: MOVIES },
    { prefix: "fs", type: "financial_signal", items: SIGNALS },
    { prefix: "loc", type: "location", items: LOCATIONS },
  ];
  const contentNodes: GNode[] = [];
  const accountByHandle = new Map<string, GNode>();
  for (const group of catalog) {
    group.items.forEach((item, i) => {
      const node: GNode = {
        id: `${group.prefix}${i + 1}`,
        type: group.type,
        label: item.label,
        sub: item.sub,
        clusters: item.clusters,
      };
      nodes.push(node);
      contentNodes.push(node);
      if (group.type === "social_account") accountByHandle.set(item.label, node);
    });
  }

  // --- Posts (authored) ----------------------------------------------
  const postNodes: GNode[] = [];
  POSTS.forEach((post, i) => {
    const node: GNode = {
      id: `t${i + 1}`,
      type: "post",
      label: post.label,
      sub: post.author.startsWith("@") ? `${post.author} · post` : `${post.author} · post`,
      clusters: post.clusters,
    };
    nodes.push(node);
    postNodes.push(node);
    const author = post.author.startsWith("@")
      ? accountByHandle.get(post.author)
      : personByName.get(post.author);
    if (author) addLink(author.id, node.id, "POSTED", 2);
  });

  // --- Person → content edges (taste-driven) -------------------------
  const allEngageable: GNode[] = [...contentNodes, ...postNodes];
  const connectPersonToContent = (person: GNode, personClusters: TasteCluster[], target: number) => {
    const scored = allEngageable
      .map((item) => ({ item, s: overlap(personClusters, item.clusters) + rng() * 1.4 }))
      .sort((x, y) => y.s - x.s);
    let added = 0;
    for (const { item, s } of scored) {
      if (added >= target) break;
      if (s < 0.85) break; // nothing relevant left
      const verb = item.type === "post" ? "LIKES" : EDGE_VERB_FOR_TYPE[item.type as Exclude<NodeType, "person">];
      // Don't LIKE your own post (already POSTED).
      if (links.some((l) => l.source === person.id && l.target === item.id)) continue;
      addLink(person.id, item.id, verb, Math.min(3, Math.max(1, Math.round(s))));
      added++;
    }
  };

  for (const { spec, node } of people) {
    const target = 8 + Math.floor(rng() * 6); // 8–13 items each
    connectPersonToContent(node, spec.clusters, target);
  }
  // Me: a rich but deliberately incomplete profile, so discovery has room.
  connectPersonToContent(ME, ME_CLUSTERS, 12);

  // No orphan stars: every catalog item gets at least one admirer.
  const touched = new Set<string>();
  for (const l of links) {
    touched.add(l.source as string);
    touched.add(l.target as string);
  }
  for (const item of allEngageable) {
    if (touched.has(item.id)) continue;
    let best: { node: GNode; s: number } | null = null;
    for (const { spec, node } of people) {
      const s = overlap(spec.clusters, item.clusters) + rng() * 0.3;
      if (!best || s > best.s) best = { node, s };
    }
    if (best) {
      const verb =
        item.type === "post" ? "LIKES" : EDGE_VERB_FOR_TYPE[item.type as Exclude<NodeType, "person">];
      addLink(best.node.id, item.id, verb, 1);
      touched.add(item.id);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Derived state — shared engine (also used live after every action)  */
  /* ---------------------------------------------------------------- */

  recomputeVals(nodes, links);
  const recommendations = computeRecommendations(nodes, links, "me");

  return {
    nodes,
    links,
    meId: "me",
    recommendations,
    dismissed: [],
    wallet: { balance: STARTING_BALANCE, earnedTotal: 0, ledger: [] },
  };
}

/** Stable shuffled id list — handy for demos/tests. */
export function sampleIds(seed: number, ids: string[], n: number): string[] {
  return shuffle(mulberry32(seed), ids).slice(0, n);
}

/** Deterministic 32-bit hash of a string (stable per-user seeding). */
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Build a new user's root person-node + a small starter set of FRIENDS_WITH
 * edges into the shared world, so a freshly-registered user lands in a
 * non-empty galaxy to explore (rather than an empty void). Deterministic for a
 * given userId. The root carries no `isMe` — that's set per-view at load time.
 */
export function newUserRoot(
  shared: Pick<Dataset, "nodes">,
  userId: string,
  profile: { name?: string; email?: string } = {},
  // Start ALONE by default — onboarding is search-and-connect, not auto-friending.
  starterFriends = 0,
): { node: GNode; links: GLink[] } {
  const label =
    profile.name?.trim() || profile.email?.split("@")[0]?.trim() || "Explorer";
  const persons = shared.nodes.filter(
    (n) => n.type === "person" && n.id !== userId && !n.isMe,
  );
  const rng = mulberry32(hashStr(userId));
  const friends = shuffle(rng, persons).slice(0, Math.min(starterFriends, persons.length));

  const clusters: TasteCluster[] = [];
  for (const f of friends) for (const c of f.clusters) if (!clusters.includes(c)) clusters.push(c);

  const node: GNode = {
    id: userId,
    type: "person",
    label,
    sub: profile.email ?? "Your constellation",
    clusters: clusters.slice(0, 3),
  };
  const links: GLink[] = friends.map((f) => ({
    id: `uf_${userId}__${f.id}`,
    source: userId,
    target: f.id,
    type: "FRIENDS_WITH",
    weight: 1,
  }));
  return { node, links };
}
