"use client";

import { useEffect, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { GOLD } from "@/lib/palette";

/**
 * The moment right after redeeming an invite: the new user lands already
 * connected to their inviter. Celebrate it and point them at the core loop
 * (trust search) so the graph never feels empty. Reads `?welcome=1&from=<name>`
 * left by the auth callback, then scrubs those params from the URL.
 */
export default function WelcomeToast() {
  const [from, setFrom] = useState<string | null>(null);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get("welcome") !== "1") return;
    setFrom(p.get("from"));
    // Scrub the params so a refresh / share doesn't replay the welcome.
    p.delete("welcome");
    p.delete("from");
    const qs = p.toString();
    window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
  }, []);

  if (from === null) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-20 z-50 flex justify-center px-4">
      <div className="pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-2xl border border-line bg-nebula/95 p-4 shadow-2xl backdrop-blur-md rise">
        <div
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
          style={{ background: "rgba(255,217,122,0.14)", color: GOLD }}
        >
          <Sparkles size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-bold text-ink" style={{ fontFamily: "var(--font-display)" }}>
            You're connected with {from || "your friend"} 🌟
          </p>
          <p className="mt-1 text-[13px] leading-relaxed text-dim">
            Their network is now part of yours. Try{" "}
            <b className="text-ink">✦ Trust search</b> (bottom-left) to find who your
            network trusts — a dentist, a lawyer, a mechanic.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setFrom(null)}
          className="shrink-0 text-dim hover:text-ink"
          aria-label="Dismiss"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
