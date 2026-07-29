/**
 * Seaside Startup Summit toolset — active only when the conversation invokes
 * @seasidestartupsummit (see summitContextActive). Same contract as the
 * composer tools: identity-carrying fetches, confirm-gated writes.
 */
import type { AgentTool, ToolContext, ToolOutcome } from "./loop";
import type { AgentMessage, ResolvedMention } from "@constellation/graph-core";

const str = (v: unknown, max = 200): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;

async function graphFetch(
  ctx: ToolContext,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const r = await fetch(`${ctx.graphUrl}${path}`, {
    method: init?.method ?? "GET",
    headers: { "content-type": "application/json", "x-user-id": ctx.userId },
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    signal: ctx.signal,
  });
  const body = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, body };
}

const fail = (body: unknown, status: number): ToolOutcome => ({
  ok: false,
  summary: (body as { error?: string } | null)?.error ?? `graph-service responded ${status}`,
});

/** The summit toolset stays on for the WHOLE conversation once the summit is
 *  mentioned — by @mention, by name, or in any prior turn. */
export function summitContextActive(
  text: string,
  mentions: ResolvedMention[] | undefined,
  transcript: AgentMessage[],
): boolean {
  const re = /seaside\s*startup\s*summit|@seasidestartupsummit|\bsss\b/i;
  if (re.test(text)) return true;
  if (mentions?.some((m) => re.test(m.label ?? "") || re.test(m.id ?? ""))) return true;
  return transcript.some((m) => typeof m.content === "string" && re.test(m.content));
}

/** Today in summit-local time — the model has no clock; without this it
 *  guesses dates and mislabels agenda days. */
export const yerevanToday = (): string =>
  new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "Asia/Yerevan" }).format(new Date());

export const summitPromptAddendum = (): string => `

## Seaside Startup Summit mode
TODAY IS ${yerevanToday()} (Yerevan time) — use this for "today/tomorrow" agenda questions; never guess the date.
The user invoked @seasidestartupsummit — you also have summit tools:
- FIRST INTERACTION: if you don't know the user's summit setup yet, get them
  set up conversationally — ask (in ONE friendly message) what they're
  building, the skills they offer and need, their program (Starter/Booster/
  Talent/FireCode) and their squad number (1–16) — then call
  summit_setup_profile with everything at once. This unlocks real matching.
- summit_who_to_meet: match attendees/mentors/investors to the user (modes: people, mentors, investors, startups, workshops). Lead with the top 3 and WHY.
- summit_squads / summit_join_squad / summit_my_squad / summit_confirm_squadmate: squads 1–16. Joining auto-connects the user with squadmates. Confirming a squadmate is a public attestation — encourage it after real meetings (it's how trust starts here).
- summit_agenda / summit_attend: the programme (streams: Starter, Booster, Talent, FireCode, side summits). Attending sessions improves matching.
- For mentor-session notes ("notes from my session with X"), use save_note and INCLUDE the mentor's name with an @ prefix in the note text — the docs pipeline links it and creates the mentor entity if unknown.
Keep answers event-practical: who, where, when, why.`;

const setupProfile: AgentTool = {
  name: "summit_setup_profile",
  description:
    "Set up (or update) the user's summit profile in one shot: what they're building, skills they offer/need, their program (Starter/Booster/Talent/FireCode), and their squad. This is what powers matching — run it early for new users. Collect the details conversationally first.",
  confirm: true,
  confirmTitle: "Save your summit profile?",
  confirmDescription: "Your skills, needs, startup and program become visible tags that power who-to-meet matching. Squad joining auto-connects you with squadmates.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      startup: { type: "string", description: "Startup / project name" },
      stage: { type: "string", description: "idea | mvp | revenue | scaling" },
      program: { type: "string", description: "Starter | Booster | Talent | FireCode (their summit program)" },
      skills_offered: { type: "array", items: { type: "string" }, description: "Skills/expertise they OFFER, lowercase tags (e.g. ['marketing','ml'])" },
      skills_needed: { type: "array", items: { type: "string" }, description: "Skills/help they NEED" },
      sectors: { type: "array", items: { type: "string" }, description: "Sectors/industries (e.g. ['fintech'])" },
      looking_for: { type: "array", items: { type: "string" }, description: "Subset of: investment, mentorship, cofounder, customers, partners" },
      squad: { type: "number", description: "Squad number 1–16, if they know it" },
    },
  },
  async execute(input, ctx) {
    const args = (input ?? {}) as Record<string, unknown>;
    const arr = (v: unknown) =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((s) => s.trim().toLowerCase()).filter(Boolean).slice(0, 12) : undefined;
    const properties: Record<string, unknown> = {};
    const startup = str(args.startup, 80);
    const stage = str(args.stage, 20)?.toLowerCase();
    const program = str(args.program, 20);
    if (startup) properties.startup = startup;
    if (stage && ["idea", "mvp", "revenue", "scaling"].includes(stage)) properties.stage = stage;
    if (program) properties.program = program;
    for (const key of ["skills_offered", "skills_needed", "sectors", "looking_for"] as const) {
      const v = arr(args[key]);
      if (v?.length) properties[key] = v;
    }
    if (!Object.keys(properties).length && args.squad == null) {
      return { ok: false, summary: "nothing to save — collect at least one detail first" };
    }
    const parts: string[] = [];
    if (Object.keys(properties).length) {
      const r = await graphFetch(ctx, "/api/profile", {
        method: "POST",
        body: { roles: ["founder"], properties },
      });
      if (!r.ok) return fail(r.body, r.status);
      parts.push(`profile saved (${Object.keys(properties).join(", ")})`);
    }
    const n = Number(args.squad);
    if (Number.isInteger(n) && n >= 1 && n <= 16) {
      const list = await graphFetch(ctx, "/api/squads");
      if (list.ok) {
        const squad = (list.body as { squads: { id: string; number: number; label: string }[] }).squads.find((s) => s.number === n);
        if (squad) {
          const j = await graphFetch(ctx, "/api/squads/join", { method: "POST", body: { squadId: squad.id } });
          if (j.ok) {
            const auto = (j.body as { autoConnected?: number }).autoConnected ?? 0;
            parts.push(`joined ${squad.label} (auto-connected with ${auto})`);
          }
        }
      }
    }
    return { ok: true, summary: parts.join("; ") || "saved", data: { properties } };
  },
};

const whoToMeet: AgentTool = {
  name: "summit_who_to_meet",
  description:
    "Summit matchmaking: rank the attendees/mentors/investors this user should meet, with reasons (skills, needs, same squad, shared sessions). Modes: people | mentors | investors | startups | workshops.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      mode: { type: "string", description: "people | mentors | investors | startups | workshops (default people)" },
      skill: { type: "string", description: "Optional skill/topic filter, e.g. fundraising" },
    },
  },
  async execute(input, ctx) {
    const args = (input ?? {}) as Record<string, unknown>;
    const mode = str(args.mode, 30) ?? "people";
    const qs = new URLSearchParams({ app: "summit", mode, limit: "6", includeCold: "1" });
    const skill = str(args.skill, 40);
    if (skill) qs.set("skill", skill);
    const r = await graphFetch(ctx, `/api/who-to-meet?${qs}`);
    if (!r.ok) return fail(r.body, r.status);
    const rows =
      (r.body as { suggestions?: { nodeId: string; matchPct: number; reasons: string[]; node?: { id: string; label: string } }[] })
        ?.suggestions ?? [];
    const list = rows
      .map((x) => `${x.node?.label ?? x.nodeId} (id ${x.nodeId}, ${x.matchPct}%)${x.reasons?.length ? ` — ${x.reasons.slice(0, 3).join(", ")}` : ""}`)
      .join("; ");
    return {
      ok: true,
      summary: list || `no ${mode} matches yet — the user can enrich their profile or attend sessions`,
      data: r.body,
    };
  },
};

const listSquads: AgentTool = {
  name: "summit_squads",
  description: "List summit squads 1–16 with member counts, and which one the user is in.",
  inputSchema: { type: "object", additionalProperties: false, properties: {} },
  async execute(_input, ctx) {
    const r = await graphFetch(ctx, "/api/squads");
    if (!r.ok) return fail(r.body, r.status);
    const b = r.body as { mySquadId: string | null; squads: { id: string; label: string; number: number; memberCount: number }[] };
    const mine = b.squads.find((s) => s.id === b.mySquadId);
    return {
      ok: true,
      summary: `${b.squads.map((s) => `${s.label}: ${s.memberCount}`).join(", ")}${mine ? ` — user is in ${mine.label}` : " — user hasn't joined a squad"}`,
      data: b,
    };
  },
};

const joinSquad: AgentTool = {
  name: "summit_join_squad",
  description: "Join one of the summit squads (1–16). Auto-connects the user with everyone already in it.",
  confirm: true,
  confirmTitle: "Join this squad?",
  confirmDescription: "You'll be listed as a member and automatically connected with your squadmates.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: { squad: { type: "number", description: "Squad number 1–16" } },
    required: ["squad"],
  },
  async execute(input, ctx) {
    const n = Number((input as Record<string, unknown>)?.squad);
    if (!Number.isInteger(n) || n < 1 || n > 16) return { ok: false, summary: "squad must be 1–16" };
    const list = await graphFetch(ctx, "/api/squads");
    if (!list.ok) return fail(list.body, list.status);
    const squad = (list.body as { squads: { id: string; number: number; label: string }[] }).squads.find((s) => s.number === n);
    if (!squad) return { ok: false, summary: `Squad ${n} isn't seeded yet` };
    const r = await graphFetch(ctx, "/api/squads/join", { method: "POST", body: { squadId: squad.id } });
    if (!r.ok) return fail(r.body, r.status);
    const auto = (r.body as { autoConnected?: number }).autoConnected ?? 0;
    return { ok: true, summary: `joined ${squad.label} — auto-connected with ${auto} squadmate${auto === 1 ? "" : "s"}`, data: r.body };
  },
};

const mySquad: AgentTool = {
  name: "summit_my_squad",
  description: "The user's squad and its members, with peer-confirmation counts (who has been vouched for).",
  inputSchema: { type: "object", additionalProperties: false, properties: {} },
  async execute(_input, ctx) {
    const r = await graphFetch(ctx, "/api/squads/mine");
    if (!r.ok) return fail(r.body, r.status);
    const b = r.body as { squad: { label: string } | null; members: { id: string; label: string; me: boolean; confirmations: number; confirmedByMe: boolean }[] };
    if (!b.squad) return { ok: true, summary: "the user hasn't joined a squad yet — offer summit_join_squad", data: b };
    return {
      ok: true,
      summary: `${b.squad.label}: ${b.members.map((m) => `${m.label}${m.me ? " (you)" : ""} — ${m.confirmations} confirmation${m.confirmations === 1 ? "" : "s"}${m.confirmedByMe ? ", confirmed by you" : ""}`).join("; ")}`,
      data: b,
    };
  },
};

const confirmSquadmate: AgentTool = {
  name: "summit_confirm_squadmate",
  description: "Vouch that a person really is in the user's squad (peer attestation — a small public trust signal).",
  confirm: true,
  confirmTitle: "Confirm this squadmate?",
  confirmDescription: "You publicly attest they're in your squad. Confirmations are visible to everyone.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: { name: { type: "string", description: "The squadmate's name (as shown in summit_my_squad)" } },
    required: ["name"],
  },
  async execute(input, ctx) {
    const name = str((input as Record<string, unknown>)?.name, 80);
    if (!name) return { ok: false, summary: "name required" };
    const mine = await graphFetch(ctx, "/api/squads/mine");
    if (!mine.ok) return fail(mine.body, mine.status);
    const members = (mine.body as { members: { id: string; label: string; me: boolean }[] }).members;
    const lower = name.toLowerCase();
    const member =
      members.find((m) => !m.me && m.label.toLowerCase() === lower) ??
      members.find((m) => !m.me && m.label.toLowerCase().includes(lower));
    if (!member) return { ok: false, summary: `no squadmate matching "${name}" — use summit_my_squad to list members` };
    const r = await graphFetch(ctx, "/api/squads/confirm", { method: "POST", body: { memberId: member.id } });
    if (!r.ok) return fail(r.body, r.status);
    return { ok: true, summary: `confirmed ${member.label} as a squadmate`, data: { memberId: member.id } };
  },
};

const agenda: AgentTool = {
  name: "summit_agenda",
  description:
    "The summit programme. Filter by day ('Jul 29') and/or stream (Starter, Booster, Talent, FireCode, Side Events…).",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      day: { type: "string", description: "e.g. Jul 29" },
      stream: { type: "string", description: "Programme stream name" },
    },
  },
  async execute(input, ctx) {
    const args = (input ?? {}) as Record<string, unknown>;
    const day = str(args.day, 20)?.toLowerCase();
    const stream = str(args.stream, 40)?.toLowerCase();
    const r = await graphFetch(ctx, "/api/programme?app=summit");
    if (!r.ok) return fail(r.body, r.status);
    // Programme items come WRAPPED: {node, attendees, attending}.
    const items = (
      (r.body as { items?: { node: { id: string; label: string; properties?: Record<string, unknown> }; attendees?: number; attending?: boolean }[] })?.items ?? []
    );
    // Dated (crawled) sessions outrank legacy demo workshops without a day;
    // no day filter → default to TODAY so "what's on?" is never last week.
    const effectiveDay = day ?? yerevanToday().toLowerCase();
    let match = items.filter((it) => {
      const p = it.node.properties ?? {};
      const okDay = String(p.day ?? "").toLowerCase().includes(effectiveDay);
      const okStream = !stream || String(p.stream ?? "").toLowerCase().includes(stream);
      return okDay && okStream;
    });
    if (!match.length) {
      // explicit day/stream with no hits, or an off-agenda day: fall back to
      // everything (dated first, sorted by day+time).
      match = items
        .filter((it) => !stream || String((it.node.properties ?? {}).stream ?? "").toLowerCase().includes(stream))
        .sort((a, b) => {
          const pa = a.node.properties ?? {}, pb = b.node.properties ?? {};
          return String(pa.day ? `1${pa.day}${pa.time}` : `2`).localeCompare(String(pb.day ? `1${pb.day}${pb.time}` : `2`));
        });
    }
    const summary = match.slice(0, 15)
      .map((it) => {
        const p = it.node.properties ?? {};
        return `${it.node.label} (${[p.day, p.time, p.stream].filter(Boolean).join(", ")}${it.attending ? ", attending" : ""}, id ${it.node.id})`;
      })
      .join("; ");
    return {
      ok: true,
      summary: summary
        ? `${day ? "" : `today (${yerevanToday()}): `}${summary}`
        : `no sessions match${day || stream ? " that filter — retry without day/stream" : " — the agenda may not be imported yet"}`,
      data: { items: match.slice(0, 40) },
    };
  },
};

const attend: AgentTool = {
  name: "summit_attend",
  description: "Mark the user as attending a session/workshop (improves matching with co-attendees).",
  confirm: true,
  confirmTitle: "Attend this session?",
  confirmDescription: "You'll be marked as attending — co-attendees see better matches with you.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: { session: { type: "string", description: "Session title (or id) from summit_agenda" } },
    required: ["session"],
  },
  async execute(input, ctx) {
    const q = str((input as Record<string, unknown>)?.session, 120);
    if (!q) return { ok: false, summary: "session required" };
    const r = await graphFetch(ctx, "/api/programme?app=summit");
    if (!r.ok) return fail(r.body, r.status);
    const items = ((r.body as { items?: { node: { id: string; label: string } }[] })?.items ?? []).map((it) => it.node);
    const lower = q.toLowerCase();
    const session =
      items.find((it) => it.id === q) ??
      items.find((it) => it.label.toLowerCase() === lower) ??
      items.find((it) => it.label.toLowerCase().includes(lower));
    if (!session) return { ok: false, summary: `no session matching "${q}"` };
    const a = await graphFetch(ctx, "/api/attend", { method: "POST", body: { workshopId: session.id } });
    if (!a.ok) return fail(a.body, a.status);
    return { ok: true, summary: `attending ${session.label}`, data: { sessionId: session.id } };
  },
};

export const summitTools: AgentTool[] = [
  setupProfile,
  whoToMeet,
  listSquads,
  joinSquad,
  mySquad,
  confirmSquadmate,
  agenda,
  attend,
];
