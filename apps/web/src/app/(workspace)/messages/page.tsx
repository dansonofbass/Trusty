"use client";

import { Suspense } from "react";
import MessagesView from "@/components/messages/MessagesView";

/** Messages — squad group chat now, community groups later. */
export default function MessagesPage() {
  return (
    <Suspense fallback={null}>
      <MessagesView />
    </Suspense>
  );
}
