"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import GraphDataProvider, { useGraphData } from "@/lib/graph/GraphDataProvider";
import ChatProvider from "@/lib/chat/ChatProvider";
import Sidebar from "@/components/shell/Sidebar";
import { switchMode } from "@/lib/dataSource";

// Client-only islands (canvas/window dependencies) — same pattern as the old
// home page: decide mobile vs desktop BEFORE mounting anything heavy.
const InspectorHost = dynamic(() => import("@/components/shell/InspectorHost"), { ssr: false });
const CommandPalette = dynamic(() => import("@/components/shell/CommandPalette"), { ssr: false });
const AddEntity = dynamic(() => import("@/components/AddEntity"), { ssr: false });
const InvitePanel = dynamic(() => import("@/components/InvitePanel"), { ssr: false });
const WelcomeToast = dynamic(() => import("@/components/WelcomeToast"), { ssr: false });
const OutcomePrompts = dynamic(() => import("@/components/OutcomePrompts"), { ssr: false });
const PlaceModalHost = dynamic(() => import("@/components/PlaceModalHost"), { ssr: false });

function LoadingSky() {
  return (
    <div className="flex h-screen w-screen items-center justify-center">
      <div className="text-center">
        <div
          className="pulse-dot text-[15px] font-bold tracking-[0.3em] text-ink"
          style={{ fontFamily: "var(--font-display)" }}
        >
          TRUSTY
        </div>
        <p className="mt-2 text-[12px] text-[var(--color-faint)]">charting your universe…</p>
      </div>
    </div>
  );
}

/** Gates the shell on the shared dataset + renders the global notice toast. */
function Shell({ children }: { children: React.ReactNode }) {
  const { data, loadError, notice, mode } = useGraphData();

  if (loadError) {
    return (
      <main className="grid h-screen w-screen place-items-center px-6">
        <div className="panel max-w-md rounded-2xl p-6 text-center">
          <p className="eyebrow mb-2">Signal lost</p>
          <p className="text-[13px] leading-relaxed text-[var(--color-dim)]">
            Couldn&apos;t reach the graph in <b>{mode}</b> mode: {loadError}. Start it with{" "}
            <span style={{ fontFamily: "var(--font-mono)" }}>npm run dev:graph</span>, or
            explore the in-browser universe instead.
          </p>
          <button className="btn btn-gold mx-auto mt-4" onClick={() => switchMode("mock")}>
            Switch to mock data
          </button>
        </div>
      </main>
    );
  }

  if (!data) return <LoadingSky />;

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar />
      <main className="relative min-w-0 flex-1">{children}</main>

      <InspectorHost />
      <CommandPalette />
      <AddEntity variant="docked" />
      <InvitePanel />
      <WelcomeToast />
      <OutcomePrompts />
      <PlaceModalHost />

      {notice && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 max-w-[340px] -translate-x-1/2">
          <div className="panel rise px-3.5 py-2.5 text-[12.5px] text-ink">{notice}</div>
        </div>
      )}
    </div>
  );
}

/**
 * The 3-pane workspace shell (#agentic-ux-redesign): sidebar (nav + docs),
 * center stage (chat by default; graph/discover/asks/decisions/docs as
 * sibling routes), contextual Inspector on the right. Mounted once — the
 * dataset and the chat thread survive center-view navigation.
 */
export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  // Phones get the search-first /m view. Decide before mounting the heavy
  // shell; `?desktop=1` (or /m's "Desktop view") opts out, remembered per tab.
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
    <GraphDataProvider>
      <ChatProvider>
        <Shell>{children}</Shell>
      </ChatProvider>
    </GraphDataProvider>
  );
}
