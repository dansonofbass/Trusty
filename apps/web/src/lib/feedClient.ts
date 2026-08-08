/**
 * Community feed client — the front door's single read.
 *
 * One request returns the space's circles (the topic chips) and the merged
 * question feed across them, so the first screen isn't a waterfall of fetches
 * on a phone.
 */
import type { Author, Post, PostSort } from "./forumClient";

export interface FeedCircle {
  id: string;
  label: string;
  description: string;
  category: string;
  open: boolean;
  memberCount: number;
  mine: boolean;
  /** Questions asked in this circle — the number on its chip. */
  postCount: number;
  /** Curated tag vocabulary offered when asking here (admin-set). */
  suggestedTags: string[];
}

export interface FeedPage {
  space: string;
  circles: FeedCircle[];
  posts: Post[];
  authors: Record<string, Author>;
  /** Tag facets — only populated when a single circle is in scope. */
  tags: { tag: string; count: number }[];
}

export function fetchFeed(
  opts: { circleId?: string | null; tag?: string | null; sort?: PostSort; limit?: number } = {},
): Promise<FeedPage> {
  const qs = new URLSearchParams();
  if (opts.circleId) qs.set("circle", opts.circleId);
  if (opts.tag) qs.set("tag", opts.tag);
  if (opts.sort) qs.set("sort", opts.sort);
  if (opts.limit) qs.set("limit", String(opts.limit));
  const q = qs.toString();
  return fetch(`/api/feed${q ? `?${q}` : ""}`, { cache: "no-store" }).then(async (r) => {
    const body = await r.json().catch(() => null);
    if (!r.ok) throw new Error((body as { error?: string })?.error ?? `request failed (${r.status})`);
    return body as FeedPage;
  });
}
