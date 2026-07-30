/**
 * BFF-side domain events — ONLY for what graph-service can't see (session
 * lifecycle, media uploads). Everything else emits server-side. Fire-and-
 * forget: a dead pipeline must never affect a request.
 */
const GRAPH = process.env.GRAPH_SERVICE_INTERNAL_URL ?? "http://graph-service:4001";

export function emitWebEvent(
  type: "auth.login_started" | "auth.login" | "auth.login_failed" | "auth.logout" | "media.uploaded",
  userId: string | undefined,
  payload?: Record<string, unknown>,
): void {
  // The ingest route requires an authed identity header; use the actor when
  // known, a system marker otherwise (login_started/failed have no session).
  fetch(`${GRAPH}/api/events/ingest`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-user-id": userId ?? "anonymous" },
    body: JSON.stringify({ event: { type, userId, source: "web", payload } }),
  }).catch(() => {});
}
