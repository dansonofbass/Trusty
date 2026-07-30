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

/** Display metadata for space-aware UI (neutral-home directory, hero copy). */
export const SPACE_META: Record<SpaceSlug, { label: string; tagline: string; emoji: string }> = {
  summit: { label: "Seaside Startup Summit", tagline: "Squads, mentors & the agenda", emoji: "🎪" },
  irham: { label: "Iranians in Armenia", tagline: "Residency, tax, jobs — answered by people who did it", emoji: "🤝" },
};

/** The Space a host belongs to, or null for the neutral home / localhost. */
export function spaceFromHost(host?: string): SpaceSlug | null {
  const h = (host ?? (typeof window !== "undefined" ? window.location.hostname : "")).toLowerCase();
  const sub = h.split(".")[0];
  return (SPACE_SLUGS as readonly string[]).includes(sub) ? (sub as SpaceSlug) : null;
}

/** Origin for a space, derived from the current host (browser only). */
export function spaceUrl(slug: SpaceSlug): string {
  if (typeof window === "undefined") return `/`;
  const { protocol, host } = window.location;
  const current = spaceFromHost();
  const base = current ? host.slice(current.length + 1) : host;
  return `${protocol}//${slug}.${base}`;
}

/** The neutral-home origin (strips any space subdomain). */
export function homeUrl(): string {
  if (typeof window === "undefined") return `/`;
  const { protocol, host } = window.location;
  const current = spaceFromHost();
  return `${protocol}//${current ? host.slice(current.length + 1) : host}`;
}
