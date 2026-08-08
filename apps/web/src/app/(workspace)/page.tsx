"use client";

import { useEffect, useState } from "react";
import ChatView from "@/components/chat/ChatView";
import CommunityFeed from "@/components/community/CommunityFeed";
import { DEFAULT_SPACE, isCommunitySpace, SPACE_META } from "@/lib/space";

/**
 * Home.
 *
 * In a community space (irham, and the apex that now defaults to it) the front
 * door is the merged question feed — topics first, chat one tap away at /ask.
 * Everywhere else home is still the agent chat.
 *
 * The space is resolved AFTER mount because it comes from window.location,
 * which the server doesn't have. First paint uses DEFAULT_SPACE so server and
 * client agree (no hydration mismatch); only a non-default subdomain re-renders.
 */
export default function HomePage() {
  const [community, setCommunity] = useState(
    () => !!DEFAULT_SPACE && SPACE_META[DEFAULT_SPACE].community === true,
  );
  useEffect(() => setCommunity(isCommunitySpace()), []);

  return community ? <CommunityFeed /> : <ChatView />;
}
