"use client";

import ChatView from "@/components/chat/ChatView";

/**
 * The agent chat, on its own route.
 *
 * Home used to BE the chat. Now that a community space opens on its question
 * feed instead, the chat needs an address of its own — one that stays valid in
 * every space, so "new chat" and "ask the assistant" never have to branch.
 */
export default function AskPage() {
  return <ChatView />;
}
