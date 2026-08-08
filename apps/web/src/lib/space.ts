/**
 * Spaces — one platform, separate community front doors via subdomains
 * (summit.mytrusty.app, irham.mytrusty.app). A Space maps 1:1 to an ontology
 * App; the BFF stamps `x-app` from the request Host so every graph read is
 * scoped server-side. This module is the single source of truth for which
 * subdomains are Spaces.
 *
 * Isomorphic: safe in both the BFF (pass a host string) and the browser
 * (no-arg reads window.location).
 */

/** Subdomain → App slug allowlist. Adding a Space = one entry here + a Caddy
 *  site block + an ontology app row (+ DNS). */
export const SPACE_SLUGS = ["summit", "irham"] as const;
export type SpaceSlug = (typeof SPACE_SLUGS)[number];

/**
 * The Space a host resolves to when it carries NO space subdomain — the apex
 * (mytrusty.app) and localhost.
 *
 * Trusty is a multi-space platform by design, but irham is the only live
 * community right now, and a neutral front door that asks a newcomer to first
 * pick a "space" is a step that costs users and teaches nothing. So the apex
 * IS irham until a second community earns its own front door; flipping this
 * back to `null` restores the neutral home with no other change.
 */
export const DEFAULT_SPACE: SpaceSlug | null = "irham";

/**
 * Display metadata for space-aware UI (neutral-home directory, hero copy).
 *
 * `listed: false` hides a space from navigation WITHOUT breaking it: the
 * subdomain still resolves, its data is untouched, and anyone holding a link
 * keeps working. Used for spaces that have served their purpose (a finished
 * event) but shouldn't clutter the front door.
 *
 * `community: true` marks a space whose members are newcomers to the topic
 * rather than to the product — it gets the topic-first front door and the
 * stripped-down shell (see COMMUNITY chrome in Sidebar).
 */
export const SPACE_META: Record<
  SpaceSlug,
  { label: string; tagline: string; emoji: string; listed?: boolean; community?: boolean }
> = {
  // The summit is over — kept alive for its attendees' links, off the menu.
  summit: { label: "Seaside Startup Summit", tagline: "Squads, mentors & the agenda", emoji: "🎪", listed: false },
  irham: {
    label: "Iranians in Armenia",
    tagline: "Residency, tax, jobs — answered by people who did it",
    emoji: "🤝",
    listed: true,
    community: true,
  },
};

/** Spaces to advertise in navigation. */
export const LISTED_SPACES: SpaceSlug[] = SPACE_SLUGS.filter((s) => SPACE_META[s].listed !== false);

/**
 * The space subdomain literally present in a host, or null.
 *
 * Distinct from {@link spaceFromHost}, which falls back to {@link DEFAULT_SPACE}:
 * URL-building and the "you are on a subdomain" affordances must key off what
 * the host ACTUALLY says, or the apex would try to strip a subdomain it never
 * had.
 */
export function spaceSubdomain(host?: string): SpaceSlug | null {
  const h = (host ?? (typeof window !== "undefined" ? window.location.hostname : "")).toLowerCase();
  const sub = h.split(".")[0];
  return (SPACE_SLUGS as readonly string[]).includes(sub) ? (sub as SpaceSlug) : null;
}

/** The Space a host belongs to — its subdomain, else {@link DEFAULT_SPACE}. */
export function spaceFromHost(host?: string): SpaceSlug | null {
  return spaceSubdomain(host) ?? DEFAULT_SPACE;
}

/** True when the current space wants the topic-first, stripped-down shell. */
export function isCommunitySpace(host?: string): boolean {
  const s = spaceFromHost(host);
  return !!s && SPACE_META[s].community === true;
}

/** Origin for a space, derived from the current host (browser only). */
export function spaceUrl(slug: SpaceSlug): string {
  if (typeof window === "undefined") return `/`;
  const { protocol, host } = window.location;
  const current = spaceSubdomain();
  const base = current ? host.slice(current.length + 1) : host;
  return `${protocol}//${slug}.${base}`;
}

/** The neutral-home origin (strips any space subdomain). */
export function homeUrl(): string {
  if (typeof window === "undefined") return `/`;
  const { protocol, host } = window.location;
  const current = spaceSubdomain();
  return `${protocol}//${current ? host.slice(current.length + 1) : host}`;
}
