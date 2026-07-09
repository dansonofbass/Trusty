"use client";

import { useUI } from "@/lib/store";
import PlaceModal from "./PlaceModal";

/**
 * Mounts the full-screen place detail modal whenever the store holds a
 * `placeModalId`. Rendered once per surface (desktop + mobile); the modal keying
 * on `id` remounts cleanly when navigating between similar places.
 */
export default function PlaceModalHost() {
  const id = useUI((s) => s.placeModalId);
  if (!id) return null;
  return <PlaceModal key={id} id={id} />;
}
