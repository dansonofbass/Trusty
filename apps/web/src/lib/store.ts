"use client";

import { create } from "zustand";
import type { NodeType } from "@constellation/graph-core";
import type { TrustRec } from "./trustClient";

/** Active trust-search results, shared so the graph can animate/highlight them. */
export interface TrustSearchState {
  topic: string;
  geo?: string;
  recs: TrustRec[];
}

export type ViewId = "universe" | "circles" | "discover" | "path";

/** The mutually-exclusive right-side workspaces.
 *  Desktop (workspace shell) uses only "addEntity" | "invite" as overlays;
 *  "composer" | "asks" remain for the mobile /m surfaces. */
export type RightPanelId = "composer" | "asks" | "addEntity" | "invite";

/** Content of the contextual right panel (workspace shell). P1 ships the
 *  inspector; "local-graph" | "backlinks" arrive with the linking phase. */
export type RightPanelMode = "inspector" | "local-graph" | "backlinks";

/** A paid, ephemeral peek into a region centered on `center`. Session-only. */
export interface Peek {
  center: string;
  radius: number;
  cost: number;
  at: number;
}

/** The signed-in user (hydrated from /api/auth/me). */
export interface AuthUser {
  sub: string;
  name?: string;
  email?: string;
}

/** Toggleable graph layers — show/hide a whole slice of the graph. */
export interface Layers {
  /** Extracted knowledge: thought/concept nodes + their semantic edges. */
  knowledge: boolean;
  /** Trust Graph: your directed, topic-scoped TRUSTS edges. */
  trust: boolean;
}

interface UIState {
  view: ViewId;
  selectedId: string | null;
  focusId: string | null; // double-click "enter a node's neighborhood"
  hiddenTypes: NodeType[];
  layers: Layers;
  circleFilter: number | null; // isolate one Louvain circle
  pathPick: string[]; // up to two endpoints in Path view
  linkPickFrom: string | null; // entity-link mode: first node selected
  peeks: Peek[]; // token-bought temporary reveals (fade on reload)
  user: AuthUser | null; // signed-in identity
  trustSearch: TrustSearchState | null; // active trust-search results (graph overlay)
  trustFocusId: string | null; // result the user is hovering/inspecting → camera target
  graphNonce: number; // bump to force GraphExplorer to reload the dataset
  rightPanel: RightPanelId | null; // ONE right workspace at a time (ActionDock)
  geoScope: string; // the viewer's default location (Armenia scope; "yerevan")
  placeModalId: string | null; // restaurant/cafe id shown in the full-screen detail modal
  searchOpen: boolean; // unified top search (entities + trust) — ⌘K / click
  rightPanelMode: RightPanelMode | null; // contextual right panel (null = closed)
  graphCenterRequest: string | null; // "center this node on /graph" — cross-route camera contract
  chatPrefill: string | null; // seed the center chat input (Decisions → discuss, palette)
  paletteOpen: boolean; // ⌘K command palette (workspace shell)
  sidebarCollapsed: boolean; // workspace sidebar, persisted
  docsNonce: number; // bump to refresh doc lists (agent saved a note, editor saved)

  setView: (v: ViewId) => void;
  select: (id: string | null) => void;
  setFocus: (id: string | null) => void;
  toggleType: (t: NodeType) => void;
  setHiddenTypes: (t: NodeType[]) => void;
  toggleLayer: (k: keyof Layers) => void;
  setCircleFilter: (c: number | null) => void;
  pickPathNode: (id: string) => void;
  clearPath: () => void;
  tracePathTo: (meId: string, id: string) => void;
  setLinkPickFrom: (id: string | null) => void;
  addPeek: (p: Peek) => void;
  removePeek: (center: string) => void;
  clearPeeks: () => void;
  setUser: (u: AuthUser | null) => void;
  setTrustSearch: (t: TrustSearchState | null) => void;
  setTrustFocus: (id: string | null) => void;
  bumpGraph: () => void;
  setRightPanel: (p: RightPanelId | null) => void;
  toggleRightPanel: (p: RightPanelId) => void;
  setGeoScope: (geo: string) => void;
  setSearchOpen: (v: boolean) => void;
  openPlace: (id: string) => void;
  closePlace: () => void;
  setRightPanelMode: (m: RightPanelMode | null) => void;
  requestGraphCenter: (id: string) => void;
  clearGraphCenter: () => void;
  setChatPrefill: (t: string | null) => void;
  setPaletteOpen: (v: boolean) => void;
  toggleSidebar: () => void;
  bumpDocs: () => void;
  resetAll: () => void;
}

export const useUI = create<UIState>((set) => ({
  view: "universe",
  selectedId: null,
  focusId: null,
  hiddenTypes: [],
  layers: { knowledge: true, trust: true },
  circleFilter: null,
  pathPick: [],
  linkPickFrom: null,
  peeks: [],
  user: null,
  trustSearch: null,
  trustFocusId: null,
  graphNonce: 0,
  rightPanel: null,
  geoScope:
    (typeof window !== "undefined" && window.localStorage.getItem("trusty:geo")) || "yerevan",
  placeModalId: null,
  searchOpen: false,
  rightPanelMode: null,
  graphCenterRequest: null,
  chatPrefill: null,
  paletteOpen: false,
  sidebarCollapsed:
    typeof window !== "undefined" && window.localStorage.getItem("trusty:sidebar") === "1",
  docsNonce: 0,

  setView: (view) =>
    set((s) => ({
      view,
      circleFilter: view === "circles" ? s.circleFilter : null,
      pathPick: view === "path" ? s.pathPick : [],
      linkPickFrom: null,
    })),
  // Selecting a node also surfaces the inspector in the workspace shell's right
  // panel (harmless on /m — the panel host isn't mounted there).
  select: (selectedId) =>
    set((s) => ({ selectedId, rightPanelMode: selectedId ? "inspector" : s.rightPanelMode })),
  setFocus: (focusId) =>
    set((s) => ({
      focusId,
      selectedId: focusId,
      rightPanelMode: focusId ? "inspector" : s.rightPanelMode,
    })),
  toggleType: (t) =>
    set((s) => ({
      hiddenTypes: s.hiddenTypes.includes(t)
        ? s.hiddenTypes.filter((x) => x !== t)
        : [...s.hiddenTypes, t],
    })),
  setHiddenTypes: (hiddenTypes) => set({ hiddenTypes }),
  toggleLayer: (k) => set((s) => ({ layers: { ...s.layers, [k]: !s.layers[k] } })),
  setCircleFilter: (circleFilter) => set({ circleFilter }),
  pickPathNode: (id) =>
    set((s) => {
      if (s.pathPick.includes(id)) return s;
      if (s.pathPick.length >= 2) return { pathPick: [id] };
      return { pathPick: [...s.pathPick, id] };
    }),
  clearPath: () => set({ pathPick: [] }),
  tracePathTo: (meId, id) =>
    set({ view: "path", pathPick: meId === id ? [meId] : [meId, id], focusId: null, linkPickFrom: null }),
  setLinkPickFrom: (linkPickFrom) => set({ linkPickFrom }),
  addPeek: (p) =>
    set((s) =>
      s.peeks.some((q) => q.center === p.center) ? s : { peeks: [...s.peeks, p] },
    ),
  removePeek: (center) =>
    set((s) => ({ peeks: s.peeks.filter((q) => q.center !== center) })),
  clearPeeks: () => set({ peeks: [] }),
  setUser: (user) => set({ user }),
  setTrustSearch: (trustSearch) => set({ trustSearch, trustFocusId: null }),
  setTrustFocus: (trustFocusId) => set({ trustFocusId }),
  bumpGraph: () => set((s) => ({ graphNonce: s.graphNonce + 1 })),
  setRightPanel: (rightPanel) => set({ rightPanel }),
  toggleRightPanel: (p) => set((s) => ({ rightPanel: s.rightPanel === p ? null : p })),
  setGeoScope: (geoScope) => {
    try {
      window.localStorage.setItem("trusty:geo", geoScope);
    } catch {
      /* private mode */
    }
    set({ geoScope });
  },
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  openPlace: (id) => set({ placeModalId: id }),
  closePlace: () => set({ placeModalId: null }),
  setRightPanelMode: (rightPanelMode) => set({ rightPanelMode }),
  requestGraphCenter: (graphCenterRequest) => set({ graphCenterRequest }),
  clearGraphCenter: () => set({ graphCenterRequest: null }),
  setChatPrefill: (chatPrefill) => set({ chatPrefill }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  toggleSidebar: () =>
    set((s) => {
      const next = !s.sidebarCollapsed;
      try {
        window.localStorage.setItem("trusty:sidebar", next ? "1" : "0");
      } catch {
        /* private mode */
      }
      return { sidebarCollapsed: next };
    }),
  bumpDocs: () => set((s) => ({ docsNonce: s.docsNonce + 1 })),
  resetAll: () =>
    set({
      selectedId: null,
      focusId: null,
      hiddenTypes: [],
      layers: { knowledge: true, trust: true },
      circleFilter: null,
      pathPick: [],
      linkPickFrom: null,
      peeks: [],
      trustSearch: null,
      trustFocusId: null,
      rightPanel: null,
    }),
}));
