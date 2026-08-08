/**
 * Circle forum client — thin fetchers over the BFF routes.
 *
 * Authors come back pre-resolved (label, photo, karma, badges) from one
 * server-side resolver, so no surface has to re-derive who is a moderator or
 * a verified specialist.
 */

export type CircleRole = "owner" | "moderator";
export type PostSort = "hot" | "new" | "top";

/** `kind` is a stable key; the UI maps it to a translated label. */
export interface Badge {
  kind: string;
  value?: string;
}

export interface Author {
  id: string;
  label: string;
  photoUrl?: string;
  karma: number;
  badges: Badge[];
}

export interface Topic {
  id: string;
  circleId: string;
  label: string;
  description: string;
  position: number;
  postCount: number;
  createdAt: string;
}

export interface Post {
  id: string;
  circleId: string;
  topicId: string | null;
  authorId: string;
  title: string;
  body: string;
  pinned: boolean;
  locked: boolean;
  answerCount: number;
  score: number;
  /** Classification within the circle (visa, contract, bank…). */
  tags: string[];
  myVote: number;
  createdAt: string;
}

export interface Answer {
  id: string;
  postId: string;
  parentId: string | null;
  authorId: string;
  body: string;
  accepted: boolean;
  deleted: boolean;
  score: number;
  myVote: number;
  createdAt: string;
}

export interface CircleAbout {
  id: string;
  label: string;
  description: string;
  topicTags: string[];
  memberCount: number;
  mine: boolean;
  open: boolean;
  moderators: (Author & { role: CircleRole })[];
  contributors: Author[];
  mentors: {
    nodeId: string;
    label: string;
    nodeType: string;
    verified: boolean;
    trustLabel: string;
    trustLabelText: string;
    photoUrl?: string;
  }[];
  canModerate: boolean;
}

async function jsonOrThrow(r: Response) {
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error((body as { error?: string })?.error ?? `request failed (${r.status})`);
  return body;
}

const enc = encodeURIComponent;

/* --------------------------------- reads -------------------------------- */

export const fetchCircleAbout = (circleId: string): Promise<CircleAbout> =>
  fetch(`/api/circles/${enc(circleId)}/about`, { cache: "no-store" }).then(jsonOrThrow) as Promise<CircleAbout>;

export const fetchTopics = (circleId: string): Promise<{ topics: Topic[] }> =>
  fetch(`/api/circles/${enc(circleId)}/topics`, { cache: "no-store" }).then(jsonOrThrow) as Promise<{ topics: Topic[] }>;

export interface PostsPage {
  posts: Post[];
  authors: Record<string, Author>;
  /** Tags in use in this circle, most-used first — powers the filter row. */
  tags: { tag: string; count: number }[];
}

export function fetchPosts(
  circleId: string,
  opts: { topicId?: string; tag?: string; sort?: PostSort; limit?: number } = {},
): Promise<PostsPage> {
  const qs = new URLSearchParams();
  if (opts.topicId) qs.set("topic", opts.topicId);
  if (opts.tag) qs.set("tag", opts.tag);
  if (opts.sort) qs.set("sort", opts.sort);
  if (opts.limit) qs.set("limit", String(opts.limit));
  const q = qs.toString();
  return fetch(`/api/circles/${enc(circleId)}/posts${q ? `?${q}` : ""}`, { cache: "no-store" }).then(
    jsonOrThrow,
  ) as Promise<PostsPage>;
}

export const fetchThread = (
  postId: string,
): Promise<{ post: Post; answers: Answer[]; authors: Record<string, Author>; canModerate: boolean }> =>
  fetch(`/api/posts/${enc(postId)}`, { cache: "no-store" }).then(jsonOrThrow) as Promise<{
    post: Post;
    answers: Answer[];
    authors: Record<string, Author>;
    canModerate: boolean;
  }>;

/* -------------------------------- writes -------------------------------- */

const post = (url: string, body?: unknown) =>
  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }).then(jsonOrThrow);

export const createTopic = (circleId: string, input: { label: string; description?: string; position?: number }) =>
  post(`/api/circles/${enc(circleId)}/topics`, input) as Promise<{ ok: true; id: string }>;

export const createPost = (
  circleId: string,
  input: { topicId?: string | null; title: string; body?: string; tags?: string[] },
) =>
  post(`/api/circles/${enc(circleId)}/posts`, input) as Promise<{ ok: true; id: string }>;

export const createAnswer = (postId: string, input: { body: string; parentId?: string | null }) =>
  post(`/api/posts/${enc(postId)}/answers`, input) as Promise<{ ok: true; id: string }>;

/** `value` 1 | -1 | 0 (0 clears). Returns the recomputed score. */
export const votePost = (postId: string, value: number) =>
  post(`/api/posts/${enc(postId)}/vote`, { value }) as Promise<{ ok: true; score: number; myVote: number }>;

export const voteAnswer = (answerId: string, value: number) =>
  post(`/api/answers/${enc(answerId)}/vote`, { value }) as Promise<{ ok: true; score: number; myVote: number }>;

export const acceptAnswer = (answerId: string) => post(`/api/answers/${enc(answerId)}/accept`);

export const deleteAnswer = (answerId: string) =>
  fetch(`/api/answers/${enc(answerId)}`, { method: "DELETE" }).then(jsonOrThrow);

export const moderatePost = (postId: string, patch: { pinned?: boolean; locked?: boolean; deleted?: boolean }) =>
  fetch(`/api/posts/${enc(postId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  }).then(jsonOrThrow);
