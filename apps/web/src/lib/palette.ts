import type { EdgeType, NodeType } from "@constellation/graph-core";

/**
 * The taxonomy IS the palette: ten hues spread around the wheel so every node
 * type is identifiable at a glance on the deep-indigo sky.
 */
export const NODE_COLOR: Record<NodeType, string> = {
  person: "#7c96ff",
  book: "#f0a04b",
  news: "#ff6157",
  music: "#e25cff",
  video: "#ff5c9e",
  social_account: "#3fc6f4",
  post: "#2ee6ca",
  movie: "#a578ff",
  financial_signal: "#54d26e",
  location: "#e3c84b",
  thought: "#ffd97a", // gold — your own writing, kin to the frontier
  concept: "#9af0c8", // mint — extracted ideas
  menu_item: "#ffb347", // warm amber — a dish, kin to its place's gold
  recommendation: "#ff8c5a", // coral — kin to the trust graph (evidence)
  outcome: "#54d26e", // green — verified evidence
};

/** Brand accent — orange. THE UI action/highlight color (see --color-accent). */
export const ACCENT = "#ff8c5a";
/** DEPRECATED alias — gold was retired from the UI; kept so legacy imports land
 *  on the brand accent. Canvas taxonomy keeps its own #ffd97a via NODE_COLOR. */
export const GOLD = ACCENT;
export const ME_CORE = "#ffffff";

/** Small canvas glyph drawn inside larger nodes. */
export const NODE_GLYPH: Record<NodeType, string> = {
  person: "", // persons show their initial
  book: "B",
  news: "N",
  music: "♪",
  video: "▶",
  social_account: "@",
  post: "✦",
  movie: "M",
  financial_signal: "$",
  location: "◉",
  thought: "✎",
  concept: "◆",
  menu_item: "🍴",
  recommendation: "✦",
  outcome: "✓",
};

export const EDGE_BASE: Record<EdgeType, { color: string; width: number }> = {
  FRIENDS_WITH: { color: "rgba(124,150,255,0.40)", width: 1.3 },
  READS: { color: "rgba(160,175,230,0.14)", width: 0.6 },
  LISTENS_TO: { color: "rgba(160,175,230,0.14)", width: 0.6 },
  WATCHES: { color: "rgba(160,175,230,0.14)", width: 0.6 },
  FOLLOWS: { color: "rgba(160,175,230,0.14)", width: 0.6 },
  LIKES: { color: "rgba(160,175,230,0.14)", width: 0.6 },
  POSTED: { color: "rgba(160,175,230,0.20)", width: 0.8 },
  TRACKS: { color: "rgba(160,175,230,0.14)", width: 0.6 },
  VISITED: { color: "rgba(160,175,230,0.14)", width: 0.6 },
  RECOMMENDED: { color: "rgba(255,217,122,0.55)", width: 1.1 },
  MENTIONS: { color: "rgba(154,240,200,0.30)", width: 0.8 },
  RELATES_TO: { color: "rgba(154,240,200,0.55)", width: 1.2 },
  SAME_AS: { color: "rgba(180,140,255,0.65)", width: 1.4 },
  REFLECTS_ON: { color: "rgba(255,217,122,0.40)", width: 1.1 },
  PART_OF: { color: "rgba(255,179,71,0.35)", width: 0.9 },
  TRUSTS: { color: "rgba(255,140,90,0.65)", width: 1.6 },
  INVITED: { color: "rgba(124,150,255,0.30)", width: 0.9 },
  LISTENS_TO_PERSON: { color: "rgba(63,198,244,0.45)", width: 1.0 },
  AUTHORED: { color: "rgba(255,140,90,0.45)", width: 1.0 },
  TARGETS: { color: "rgba(255,140,90,0.55)", width: 1.2 },
  SUPPORTED_BY: { color: "rgba(84,210,110,0.50)", width: 1.0 },
  MEMBER_OF: { color: "rgba(124,150,255,0.45)", width: 1.2 },
  SAVED: { color: "rgba(154,240,200,0.45)", width: 1.0 },
  // Event relationship graph (Trusty Sevan) — concept/attribute links stay quiet
  // (mint, like the knowledge layer); MET_AT reads as a social moment (indigo).
  USES: { color: "rgba(154,240,200,0.28)", width: 0.7 },
  NEEDS: { color: "rgba(255,179,71,0.35)", width: 0.8 },
  OFFERS: { color: "rgba(154,240,200,0.35)", width: 0.8 },
  INTERESTED_IN: { color: "rgba(154,240,200,0.22)", width: 0.6 },
  ATTENDING: { color: "rgba(124,150,255,0.30)", width: 0.7 },
  MET_AT: { color: "rgba(124,150,255,0.50)", width: 1.2 },
};

/** Accent for the Trust Graph — same hue as the brand accent by design. */
export const TRUST_ACCENT = ACCENT;

/** Dashed mint for user-scoped entity links (local until promoted). */
export const USER_ENTITY_LINK_COLOR = "rgba(154,240,200,0.75)";

/** Distinct hues for Louvain circles (used in the Circles view + legend). */
export const COMMUNITY_COLORS = [
  "#7c96ff",
  "#ff8a5c",
  "#3fe0b0",
  "#e25cff",
  "#ffd97a",
  "#4fc3f7",
  "#ff5c9e",
  "#a8e063",
  "#c9a0ff",
  "#ff6157",
  "#62d9d0",
  "#f0c34b",
];

export function communityColor(i: number): string {
  return COMMUNITY_COLORS[i % COMMUNITY_COLORS.length];
}

export function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
