# Agentic workspace UX redesign

Branch: `feat/agentic-chat-ux` · Decided 2026-07-23 · Revert point: `main@501ba6e`

Trusty's desktop home moves from "full-screen graph with floating islands" to a
**3-pane agentic workspace shell**: agent chat as the center stage, an
Obsidian-style linked doc directory ("second brain"), and the graph demoted
from *the app* to a contextual panel plus a full view.

## Decisions (locked with Pooyan)

| Question | Decision |
|---|---|
| Home layout | **3-pane workspace shell** — persistent left sidebar (nav + doc tree + chat history), center stage, contextual right panel |
| Chat position | **Chat IS the center stage** — hero "What are you looking for?" empty state; opening a doc swaps the center to the editor; chat one click away |
| Graph fate | **Panel + full view** — right panel shows a *local* graph (neighborhood of current doc/entity/thread) + backlinks; full Universe/Path/Circles becomes a "Graph" nav item taking over the center |
| Doc directory | **Obsidian-style folders** — real hierarchy on `writings`; existing `collections[]` migrate to top-level folders |
| Chat persistence | **Full** — DB-backed conversations + turns, history list in sidebar, resumable, auto-titled; journeys link to spawning conversation |
| Linking depth | **Full AI auto-linking** — `[[wikilinks]]` between docs *and* to entities, stored as real edges, backlinks panel, PLUS extractor pass that proactively suggests links while writing |
| Editor | **TipTap (ProseMirror)** — WYSIWYG w/ markdown shortcuts; custom nodes for wikilinks, mentions, AI suggestion marks; markdown stored underneath |
| Social surfaces | **Fold into sidebar nav** — Feed → Discover view; Asks and Decisions (journeys) become nav items; Listen suggestions move into Discover/onboarding; no floating islands |

## Target shell

```
┌──────────┬─────────────────────────────┬──────────┐
│ TRUSTY   │                             │ context  │
│ 🔍 Discover│  CHAT (default)           │ panel:   │
│ 💬 Chats  │  "What are you looking     │  local   │
│   · lawyer│   for?" hero → thread      │  graph   │
│   · trip  │                            │  ●─○     │
│ 📄 Docs   │  — or DOC EDITOR —         │ backlinks│
│  ▾ Trips  │  # Yerevan trip            │  · doc A │
│     Yerevan│ …[[Dariush]] recommended  │  · doc B │
│  ▸ Decisions│ [[Sherep]]…              │ inspector│
│ 🌌 Graph  │                            │          │
│ 📣 Asks   │  — or GRAPH / DISCOVER /   │          │
│ ⚖ Decisions│    ASKS / DECISIONS view — │          │
│ ── wallet/user ──                      │          │
└──────────┴─────────────────────────────┴──────────┘
```

Center-stage views: `chat | doc | graph | discover | asks | decisions`.
Right panel is contextual (local graph, backlinks, node inspector) and
toggleable. Universe/Path/Circles/Lens survive inside the Graph view.

## Data model additions (graph-service Postgres)

- `conversations(id, user_id, title, created_at, updated_at)` +
  `conversation_turns(id, conversation_id, role, content, tools JSONB, at)` —
  agent thread persistence; auto-title after first exchange; journeys gain
  `conversation_id`.
- `folders(id, user_id, name, parent_id)` + `writings.folder_id` — doc tree;
  one-time migration of `collections[]` → top-level folders.
- `writing_links(id, writing_id, target_kind 'writing'|'node', target_id,
  alias, created_by 'user'|'ai', status 'confirmed'|'suggested')` — wikilinks +
  AI suggestions; entity links mirrored as `MENTIONS` edges in Neo4j so the
  graph/backlinks stay unified. Backlinks = reverse lookup over this table +
  graph edges.

## Phases

1. **Shell** — `AppShell` (sidebar/center/right-panel), center-view routing in
   `useUI`, GraphExplorer embedded as the Graph view, Feed/Asks/Journeys folded
   into nav, chat hero as home. Old overlays (ActionDock, floating pills) retire.
2. **Chat persistence** — tables + BFF routes, sidebar history, resume, auto-title.
3. **Docs** — folders API + tree UI, TipTap editor (wikilink + mention nodes),
   doc CRUD in the center stage; workspace list leaves the Composer.
4. **Linking** — `writing_links` storage, backlinks panel, local graph in the
   right panel.
5. **AI auto-linking** — extractor suggestion pass on save/idle, inline
   suggestion marks with accept/dismiss, weave integration.
6. **Polish** — ⌘K unification, wallet/contribution relocation, mobile parity
   decisions.

## Known risks

- `GraphExplorer.tsx` assumes full-screen ownership and mounts ~15 overlays —
  embedding it as a center view needs its overlay stack untangled (TopBar dies,
  Lens/Circles/Layer toggles stay inside the view).
- TipTap is a new heavy dependency; markdown fidelity (store body as markdown,
  render to TipTap doc) must round-trip cleanly with the existing extraction
  pipeline which consumes plain text.
- Two chat entry points (persisted center chat vs. quick-mode fallback) must
  share one transcript model.
