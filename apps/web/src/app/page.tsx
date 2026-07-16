"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * react-force-graph paints straight to <canvas> and needs `window`,
 * so the whole explorer is a client-only island.
 */
const GraphExplorer = dynamic(() => import("@/components/GraphExplorer"), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen w-screen items-center justify-center">
      <span
        className="pulse-dot text-[14px] font-bold tracking-[0.3em] text-ink"
        style={{ fontFamily: "var(--font-display)" }}
      >
        CONSTELLATION
      </span>
    </div>
  ),
});

// Add-entity overlay — schema-driven ontology entity creation.
const AddEntity = dynamic(() => import("@/components/AddEntity"), { ssr: false });
// Invite panel — the network growth loop (mint link, share, see conversions).
const InvitePanel = dynamic(() => import("@/components/InvitePanel"), { ssr: false });
// Welcome moment after redeeming an invite (reads ?welcome from the callback).
const WelcomeToast = dynamic(() => import("@/components/WelcomeToast"), { ssr: false });
// "Did it work out?" follow-ups for providers you acted on.
const OutcomePrompts = dynamic(() => import("@/components/OutcomePrompts"), { ssr: false });
// Ask-my-network: broadcast when search is empty; answer friends' asks.
const AsksPanel = dynamic(() => import("@/components/AsksPanel"), { ssr: false });

export default function Home() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  // The canvas is a desktop showcase; phones get the search-first /m view. Decide
  // before mounting the heavy force-graph so it never loads on mobile. `?desktop=1`
  // (or the mobile view's "Desktop view") opts out and is remembered for the tab.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const forceDesktop =
      params.get("desktop") === "1" || sessionStorage.getItem("prefer-desktop") === "1";
    if (forceDesktop) sessionStorage.setItem("prefer-desktop", "1");
    if (!forceDesktop && window.matchMedia("(max-width: 720px)").matches) {
      router.replace("/m");
      return;
    }
    setReady(true);
  }, [router]);

  if (!ready) return null;

  return (
    <>
      <GraphExplorer />
      <AddEntity />
      <InvitePanel />
      <WelcomeToast />
      <OutcomePrompts />
      <AsksPanel />
    </>
  );
}
