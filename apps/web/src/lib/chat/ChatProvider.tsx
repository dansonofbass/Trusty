"use client";

import { createContext, useContext } from "react";
import { useUI } from "@/lib/store";
import { useAgentConversation } from "./useAgentConversation";

type ChatContextValue = ReturnType<typeof useAgentConversation> & {
  /** True once the agent fell back to quick mode this session. */
  quickMode: boolean;
};

const ChatContext = createContext<ChatContextValue | null>(null);

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used inside ChatProvider");
  return ctx;
}

/**
 * Holds the center-stage agent conversation ABOVE the route swap, so
 * navigating /graph → / keeps the thread (P1 is session-ephemeral; Phase 2
 * adds DB persistence inside useAgentConversation).
 */
export default function ChatProvider({ children }: { children: React.ReactNode }) {
  const bumpDocs = useUI((s) => s.bumpDocs);
  const conv = useAgentConversation({
    onAfterTurn: bumpDocs, // the agent may have saved a note / touched a journey
  });
  return (
    <ChatContext.Provider value={{ ...conv, quickMode: !conv.agentMode }}>
      {children}
    </ChatContext.Provider>
  );
}
