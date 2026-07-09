/**
 * Invite client — same-origin BFF invite routes (which proxy to graph-service).
 * Powers the InvitePanel: mint a link, read the conversion funnel.
 */

export interface InviteRow {
  code: string;
  note?: string;
  revoked: boolean;
  createdAt: string;
  visits: number;
  joined: number;
  joinedIds: string[];
  joinedNames: string[];
}

export interface InviteStats {
  invitesCreated: number;
  totalVisits: number;
  totalJoined: number;
  conversion: number;
}

async function jsonOrThrow(r: Response) {
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error((body as { error?: string })?.error ?? `request failed (${r.status})`);
  return body;
}

/** Turn an invite code into the absolute shareable URL for the current origin. */
export function inviteUrl(code: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/invite/${code}`;
}

export async function createInvite(note?: string): Promise<{ code: string; url: string }> {
  const r = await fetch("/api/invites", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ note }),
  });
  const data = (await jsonOrThrow(r)) as { code: string };
  return { code: data.code, url: inviteUrl(data.code) };
}

export async function listInvites(): Promise<{ invites: InviteRow[]; stats: InviteStats }> {
  const r = await fetch("/api/invites", { cache: "no-store" });
  return (await jsonOrThrow(r)) as { invites: InviteRow[]; stats: InviteStats };
}
