/**
 * Notifications + messaging rooms + squad activity — thin fetchers over the
 * BFF proxies (session-authed). Room ids are opaque; squad rooms happen to be
 * `room_squad_<squadNodeId>` but the client never constructs them.
 */

export interface NotificationItem {
  id: number;
  type: string;
  actorId: string | null;
  actorLabel: string | null;
  text: string;
  targetId: string | null;
  createdAt: string;
  read: boolean;
}

export interface RoomMessage {
  id: number;
  senderId: string;
  senderLabel: string;
  mine: boolean;
  body: string;
  replyTo: number | null;
  createdAt: string;
  deleted: boolean;
}

export interface RoomSummary {
  id: string;
  kind: string;
  title: string;
  memberCount: number;
  unread: number;
  lastMessage: (Omit<RoomMessage, "mine"> & { mine?: boolean }) | null;
}

export interface RoomThread {
  room: { id: string; kind: string; title: string; refId: string | null };
  members: { id: string; label: string; me: boolean }[];
  messages: RoomMessage[];
}

export interface SquadActivity {
  chatter: { squadId: string; squad: string; messages24h: number; lastAt: string; memberCount: number }[];
  joins: { squadId: string; squad: string; memberId: string; member: string; at: string }[];
}

const jsonOrThrow = async (r: Response) => {
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `HTTP ${r.status}`);
  return r.json();
};

export const fetchNotifications = (): Promise<{ items: NotificationItem[]; unread: number }> =>
  fetch("/api/notifications").then(jsonOrThrow);

export const markNotificationsRead = (ids?: number[]): Promise<void> =>
  fetch("/api/notifications/read", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(ids ? { ids } : {}),
  }).then(() => undefined);

export const fetchRooms = (): Promise<{ rooms: RoomSummary[] }> =>
  fetch("/api/rooms").then(jsonOrThrow);

export const fetchRoomMessages = (roomId: string, before?: number): Promise<RoomThread> =>
  fetch(
    `/api/rooms/${encodeURIComponent(roomId)}/messages${before ? `?before=${before}` : ""}`,
  ).then(jsonOrThrow);

export const sendRoomMessage = (
  roomId: string,
  body: string,
  replyTo?: number,
): Promise<{ message: RoomMessage }> =>
  fetch(`/api/rooms/${encodeURIComponent(roomId)}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body, ...(replyTo ? { replyTo } : {}) }),
  }).then(jsonOrThrow);

export const deleteRoomMessage = (roomId: string, messageId: number): Promise<void> =>
  fetch(`/api/rooms/${encodeURIComponent(roomId)}/messages/${messageId}`, { method: "DELETE" }).then(
    () => undefined,
  );

export const markRoomRead = (roomId: string): Promise<void> =>
  fetch(`/api/rooms/${encodeURIComponent(roomId)}/read`, { method: "POST" }).then(() => undefined);

export const fetchSquadActivity = (): Promise<SquadActivity> =>
  fetch("/api/squads/activity").then(jsonOrThrow);

/* ----------------------------- circles ----------------------------- */

export interface CircleSummary {
  id: string;
  label: string;
  description: string;
  category: string;
  open: boolean;
  memberCount: number;
  mine: boolean;
  roomId: string;
}

export const fetchCircles = (): Promise<{ circles: CircleSummary[] }> =>
  fetch("/api/circles").then(jsonOrThrow);

export const createCircle = (input: {
  name: string;
  description?: string;
  category?: string;
  open?: boolean;
}): Promise<{ circleId: string; roomId: string }> =>
  fetch("/api/circles", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  }).then(jsonOrThrow);

export const joinCircle = (id: string): Promise<{ roomId: string }> =>
  fetch(`/api/circles/${encodeURIComponent(id)}/join`, { method: "POST" }).then(jsonOrThrow);

export const leaveCircle = (id: string): Promise<void> =>
  fetch(`/api/circles/${encodeURIComponent(id)}/leave`, { method: "POST" }).then(() => undefined);

export const addCircleMember = (id: string, personId: string): Promise<void> =>
  fetch(`/api/circles/${encodeURIComponent(id)}/members`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ personId }),
  }).then(() => undefined);

/* -------------------------- saved answers -------------------------- */

export interface SavedAnswer {
  id: number;
  messageId?: number;
  body: string;
  authorLabel?: string;
  author?: string;
  room?: string;
  topics: string[];
  createdAt?: string;
  savedAt?: string;
}

export const saveMessageAsAnswer = (roomId: string, messageId: number): Promise<{ created: boolean }> =>
  fetch(`/api/rooms/${encodeURIComponent(roomId)}/messages/${messageId}/save-answer`, {
    method: "POST",
  }).then(jsonOrThrow);

export const fetchRoomAnswers = (roomId: string): Promise<{ answers: SavedAnswer[] }> =>
  fetch(`/api/rooms/${encodeURIComponent(roomId)}/answers`).then(jsonOrThrow);
