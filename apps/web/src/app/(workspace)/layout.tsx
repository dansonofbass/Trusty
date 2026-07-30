"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Menu, SquarePen } from "lucide-react";
import GraphDataProvider, { useGraphData } from "@/lib/graph/GraphDataProvider";
import ChatProvider, { useChat } from "@/lib/chat/ChatProvider";
import Sidebar from "@/components/shell/Sidebar";
import Brand from "@/components/Brand";
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
  const { newChat, sending } = useChat();
  const router = useRouter();
  const pathname = usePathname();
  // ChatGPT-app-style mobile chrome: ☰ opens the sidebar as a drawer.
  const [drawerOpen, setDrawerOpen] = useState(false);
  useEffect(() => setDrawerOpen(false), [pathname]);

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
    <div className="flex h-dvh w-screen flex-col overflow-hidden md:flex-row">
      {/* Mobile top bar (ChatGPT style): menu · brand · new chat */}
      <header className="flex shrink-0 items-center justify-between border-b border-line bg-[color-mix(in_srgb,var(--color-card)_92%,transparent)] px-2 pb-1.5 pt-[max(env(safe-area-inset-top),8px)] backdrop-blur-md md:hidden">
        <button
          type="button"
          aria-label="Open menu"
          onClick={() => setDrawerOpen(true)}
          className="grid h-10 w-10 place-items-center rounded-xl border border-[var(--color-line)] bg-[rgba(146,166,255,0.08)] text-ink transition active:bg-[var(--color-tint)]"
        >
          <Menu size={21} strokeWidth={2.2} />
        </button>
        <Brand />
        <button
          type="button"
          aria-label="New chat"
          onClick={() => {
            if (sending) return;
            newChat();
            router.push("/");
          }}
          className="grid h-10 w-10 place-items-center rounded-xl border border-[var(--color-line)] bg-[rgba(146,166,255,0.08)] text-ink transition active:bg-[var(--color-tint)]"
        >
          <SquarePen size={19} strokeWidth={2.2} />
        </button>
      </header>

      {/* Desktop sidebar */}
      <div className="hidden h-full shrink-0 md:block">
        <Sidebar />
      </div>

      <main className="relative min-h-0 min-w-0 flex-1">{children}</main>

      {/* Mobile drawer: the same sidebar, sliding in from the left */}
      {drawerOpen && (
        <div className="fixed inset-0 z-[70] md:hidden">
          <div
            className="absolute inset-0 bg-black/55"
            onClick={() => setDrawerOpen(false)}
            aria-hidden
          />
          <div className="drawer-in absolute inset-y-0 left-0 w-[300px] max-w-[85vw] shadow-2xl">
            <Sidebar onNavigate={() => setDrawerOpen(false)} />
          </div>
        </div>
      )}

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
  // Phones no longer bounce to /m — the shell is responsive (mobile chrome in
  // Shell above). /m stays reachable directly as the legacy search-first view.
  return (
    <GraphDataProvider>
      <ChatProvider>
        <Shell>{children}</Shell>
      </ChatProvider>
    </GraphDataProvider>
  );
}
