"use client";

import { useRouter } from "next/navigation";
import { Scale } from "lucide-react";
import JourneysPanel from "@/components/composer/JourneysPanel";
import { useUI } from "@/lib/store";

/**
 * Decisions — your decision journeys (#35) as a center view. "Discuss" seeds
 * the center chat and hands off to the agent.
 */
export default function DecisionsPage() {
  const router = useRouter();
  const setChatPrefill = useUI((s) => s.setChatPrefill);
  const docsNonce = useUI((s) => s.docsNonce);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line px-5 py-2.5">
        <Scale size={13} style={{ color: "var(--color-accent)" }} />
        <span className="text-[12.5px] font-semibold text-ink" style={{ fontFamily: "var(--font-display)" }}>
          My decisions
        </span>
      </div>
      <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[720px] px-4 py-4">
          <JourneysPanel
            refreshKey={docsNonce}
            onDiscuss={(j) => {
              setChatPrefill(
                `Continue my "${j.title}" decision journey (id ${j.id}) — summarize where I stand and suggest the next step.`,
              );
              router.push("/");
            }}
          />
        </div>
      </div>
    </div>
  );
}
