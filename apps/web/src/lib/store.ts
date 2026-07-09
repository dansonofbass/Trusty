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

export type ViewId = "universe" | "circles" | "discover" | "path" | "write";

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
  inviteOpen: boolean; // controls the InvitePanel (onboarding can open it)
  placeModalId: string | null; // restaurant/cafe id shown in the full-screen detail modal

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
  setInviteOpen: (v: boolean) => void;
  openPlace: (id: string) => void;
  closePlace: () => void;
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
  inviteOpen: false,
  placeModalId: null,

  setView: (view) =>
    set((s) => ({
      view,
      circleFilter: view === "circles" ? s.circleFilter : null,
      pathPick: view === "path" ? s.pathPick : [],
      linkPickFrom: view === "write" ? s.linkPickFrom : null,
    })),
  select: (selectedId) => set({ selectedId }),
  setFocus: (focusId) => set({ focusId, selectedId: focusId }),
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
  setInviteOpen: (inviteOpen) => set({ inviteOpen }),
  openPlace: (id) => set({ placeModalId: id }),
  closePlace: () => set({ placeModalId: null }),
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
    }),
}));
