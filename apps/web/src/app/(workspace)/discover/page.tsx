"use client";

import { useRouter } from "next/navigation";
import { Radio } from "lucide-react";
import { FeedContent } from "@/components/FeedPanel";
import { useUI } from "@/lib/store";

/**
 * Discover — recommendations from the people you listen to, as a center
 * view. The old feed↔graph live-highlight dual view retired with the shell;
 * each card's ⌖ jumps to /graph centered on the node instead.
 */
export default function DiscoverPage() {
  const router = useRouter();
  const select = useUI((s) => s.select);
  const requestGraphCenter = useUI((s) => s.requestGraphCenter);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line px-5 py-2.5">
        <Radio size={13} style={{ color: "var(--color-accent)" }} />
        <span className="text-[12.5px] font-semibold text-ink" style={{ fontFamily: "var(--font-display)" }}>
          Discover
        </span>
        <span className="text-[10.5px] text-[var(--color-faint)]">
          recommendations from people you listen to
        </span>
      </div>
      <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[720px] px-4 py-4">
          <FeedContent
            selected={null}
            onJump={(id) => {
              select(id);
              requestGraphCenter(id);
              router.push("/graph");
            }}
          />
        </div>
      </div>
    </div>
  );
}
