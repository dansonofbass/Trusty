import { NextResponse } from "next/server";

/**
 * Minimal per-key rate limiting for the BFF.
 *
 * The extraction routes proxy to LLM-backed endpoints, so an authenticated user
 * (or a stolen session) could otherwise run up unbounded model cost. This is a
 * fixed-window counter kept in process memory — good enough for a single BFF
 * instance and dev; behind multiple replicas, swap the Map for Redis (the call
 * sites don't change). Fail-open only on our own bugs, never on limit.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateResult {
  ok: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the window resets (only meaningful when !ok). */
  retryAfter: number;
}

export function rateLimit(key: string, limit: number, windowMs: number): RateResult {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(key, b);
  }
  b.count += 1;

  // Opportunistic cleanup so the map can't grow without bound.
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
  }

  const ok = b.count <= limit;
  return {
    ok,
    limit,
    remaining: Math.max(0, limit - b.count),
    retryAfter: ok ? 0 : Math.ceil((b.resetAt - now) / 1000),
  };
}

const EXTRACT_LIMIT = Number(process.env.EXTRACT_RATE_LIMIT ?? 20);
const EXTRACT_WINDOW_MS = Number(process.env.EXTRACT_RATE_WINDOW_MS ?? 60_000);

/** Rate limit for the LLM-backed extraction endpoints, keyed per user. */
export function extractionRateLimit(userId: string): RateResult {
  return rateLimit(`extract:${userId}`, EXTRACT_LIMIT, EXTRACT_WINDOW_MS);
}

/** Standard 429 response carrying Retry-After + rate headers. */
export function rateLimited(r: RateResult): NextResponse {
  return NextResponse.json(
    { error: "rate limit exceeded — slow down and try again shortly" },
    {
      status: 429,
      headers: {
        "retry-after": String(r.retryAfter),
        "x-ratelimit-limit": String(r.limit),
        "x-ratelimit-remaining": String(r.remaining),
      },
    },
  );
}
