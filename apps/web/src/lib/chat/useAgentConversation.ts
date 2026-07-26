"use client";

import { useCallback, useRef, useState } from "react";
import type {
  AgentMessage,
  AgentStreamEvent,
  ResolvedMention,
  ThoughtExtraction,
} from "@constellation/graph-core";
import { AgentUnavailableError, streamAgentTurn } from "@/lib/agentClient";
import { TOOL_LABEL, type AgentChatEntry, type TrustToolData } from "@/components/composer/AgentChat";
import { useUI } from "@/lib/store";
import {
  createConversation,
  entriesFromTurns,
  getConversation,
  saveTurns,
} from "./conversationsClient";

/**
 * The agent conversation loop (#29), extracted from the Composer so the
 * desktop ChatView (center stage) and the mobile Composer share ONE
 * implementation. The transcript is server-canonical — we store what `done`
 * returned and resend it each turn (the loop is stateless over HTTP).
 * Phase 2 (chat persistence) adds conversationId + turn storage here.
 */
export function useAgentConversation(opts?: {
  /** Called after every completed turn (the agent may have saved a note,
   *  created an ask, or touched a decision journey). */
  onAfterTurn?: () => void;
  /** Called once when the agent endpoint is unavailable (quick-mode fallback). */
  onAgentUnavailable?: () => void;
}) {
  const [agentMode, setAgentMode] = useState(true);
  const [chat, setChat] = useState<AgentChatEntry[]>([]);
  const [sending, setSending] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const transcriptRef = useRef<AgentMessage[]>([]);
  const conversationIdRef = useRef<string | null>(null);
  const chatRef = useRef<AgentChatEntry[]>([]);
  chatRef.current = chat;
  const sessionIdRef = useRef<string>("");
  if (!sessionIdRef.current && typeof crypto !== "undefined") {
    sessionIdRef.current = crypto.randomUUID?.() ?? `s_${Date.now().toString(36)}`;
  }

  const optsRef = useRef(opts);
  optsRef.current = opts;

  /** Patch the last (streaming) assistant entry. */
  const patchTail = useCallback((fn: (e: AgentChatEntry) => AgentChatEntry) => {
    setChat((prev) => {
      for (let i = prev.length - 1; i >= 0; i--) {
        if (prev[i].role === "assistant") {
          const next = [...prev];
          next[i] = fn(next[i]);
          return next;
        }
      }
      return prev;
    });
  }, []);

  const handleEvent = useCallback(
    (ev: AgentStreamEvent) => {
      if (ev.type === "step") {
        patchTail((e) => {
          const trace = [...e.trace];
          const i = trace.findIndex((t) => t.id === ev.id);
          const item = { id: ev.id, label: ev.label, status: ev.status, summary: ev.summary };
          if (i >= 0) trace[i] = { ...trace[i], ...item };
          else trace.push(item);
          return { ...e, trace };
        });
      } else if (ev.type === "tool_call") {
        patchTail((e) => ({
          ...e,
          trace: [
            ...e.trace,
            { id: ev.id, label: TOOL_LABEL[ev.tool] ?? ev.tool.replace(/_/g, " "), status: "active" as const, tool: ev.tool },
          ],
        }));
      } else if (ev.type === "tool_result") {
        patchTail((e) => {
          const trace = e.trace.map((t) =>
            t.id === ev.id ? { ...t, status: ev.ok ? ("done" as const) : ("error" as const), summary: ev.summary } : t,
          );
          const trustData =
            ev.tool === "trust_search" && ev.ok && ev.data
              ? (ev.data as TrustToolData)
              : e.trustData;
          const weaveData =
            ev.tool === "extract_entities" && ev.ok && ev.data
              ? (ev.data as { text: string; extraction: ThoughtExtraction })
              : e.weaveData;
          return { ...e, trace, trustData, weaveData };
        });
      } else if (ev.type === "token") {
        patchTail((e) => ({ ...e, text: e.text + ev.content }));
      } else if (ev.type === "confirm") {
        patchTail((e) => ({
          ...e,
          confirm: { id: ev.id, tool: ev.tool, args: ev.args, title: ev.title, description: ev.description },
        }));
      }
    },
    [patchTail],
  );

  /** Persist the completed turn (fire-and-forget; the chat works without a
   *  DB — persistence failing must never break the conversation). Creates the
   *  conversation lazily on the first turn, auto-titled from it. */
  const persistTurn = useCallback(async (firstText?: string) => {
    try {
      if (!conversationIdRef.current) {
        const title =
          (firstText ?? chatRef.current.find((e) => e.role === "user")?.text ?? "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 80) || undefined;
        const { id } = await createConversation(title);
        conversationIdRef.current = id;
        setConversationId(id);
      }
      await saveTurns(conversationIdRef.current, chatRef.current, transcriptRef.current);
      useUI.getState().bumpChats();
    } catch {
      /* offline/disabled persistence is non-fatal */
    }
  }, []);

  /** Open a stored conversation as the active thread. */
  const loadConversation = useCallback(async (id: string) => {
    const c = await getConversation(id);
    transcriptRef.current = c.transcript;
    conversationIdRef.current = c.id;
    // Deterministic per-conversation session id keeps the agent's journey
    // memory continuous across resumes.
    sessionIdRef.current = `conv_${c.id}`;
    setConversationId(c.id);
    setChat(entriesFromTurns(c.turns));
  }, []);

  const runTurn = useCallback(
    async (input: {
      text?: string;
      mentions?: ResolvedMention[];
      resume?: { toolCallId: string; approved: boolean; args?: unknown; reason?: string };
    }) => {
      setSending(true);
      setChat((prev) => [
        ...prev,
        ...(input.text ? [{ role: "user" as const, text: input.text, trace: [] }] : []),
        { role: "assistant" as const, text: "", trace: [], streaming: true },
      ]);
      try {
        const result = await streamAgentTurn(
          {
            transcript: transcriptRef.current,
            ...(input.text ? { text: input.text, mentions: input.mentions ?? [] } : {}),
            ...(input.resume ? { resume: input.resume } : {}),
            sessionId: sessionIdRef.current,
            geo: useUI.getState().geoScope,
          },
          handleEvent,
        );
        transcriptRef.current = result.transcript;
        patchTail((e) => ({ ...e, streaming: false }));
        void persistTurn(input.text);
        optsRef.current?.onAfterTurn?.();
        return true;
      } catch (err) {
        if (err instanceof AgentUnavailableError) {
          // Drop the optimistic entries and fall back to quick mode for the session.
          setChat((prev) => prev.slice(0, input.text ? -2 : -1));
          setAgentMode(false);
          optsRef.current?.onAgentUnavailable?.();
        } else {
          patchTail((e) => ({
            ...e,
            streaming: false,
            trace: [
              ...e.trace,
              { id: `err_${Date.now()}`, label: "Agent error", status: "error" as const, summary: err instanceof Error ? err.message : String(err) },
            ],
          }));
        }
        return false;
      } finally {
        setSending(false);
      }
    },
    [handleEvent, patchTail, persistTurn],
  );

  const decide = useCallback(
    async (confirmId: string, approved: boolean, args?: unknown) => {
      if (sending) return;
      setChat((prev) =>
        prev.map((e) =>
          e.confirm?.id === confirmId
            ? { ...e, confirm: { ...e.confirm, decided: approved ? "approved" : "denied" } }
            : e,
        ),
      );
      await runTurn({ resume: { toolCallId: confirmId, approved, args } });
    },
    [sending, runTurn],
  );

  const newChat = useCallback(() => {
    transcriptRef.current = [];
    conversationIdRef.current = null;
    sessionIdRef.current = crypto.randomUUID?.() ?? `s_${Date.now().toString(36)}`;
    setConversationId(null);
    setChat([]);
  }, []);

  return { agentMode, chat, sending, runTurn, decide, newChat, conversationId, loadConversation };
}
