"use client";

/**
 * Match Score display — mirrors the TrustResult score-bar anatomy (track +
 * accent fill + mono label) so Trusty Sevan reads like Trusty, but answers
 * "who should I meet next?" instead of "who do you trust?".
 */
const ACCENT = "#ff8c5a";

export function matchBand(pct: number): string {
  if (pct >= 70) return "strong match";
  if (pct >= 40) return "good match";
  return "worth exploring";
}

/** Compact pill for list cards — e.g. "87%". */
export function MatchPill({ pct }: { pct: number }) {
  if (pct <= 0) return null;
  return (
    <span
      className="shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold"
      style={{
        background: `rgba(255,140,90,${pct >= 70 ? 0.22 : 0.13})`,
        color: ACCENT,
        fontFamily: "var(--font-mono)",
      }}
    >
      {pct}%
    </span>
  );
}

/** Full bar for the profile card — track, fill, "Match 87% · strong match". */
export default function MatchBar({ pct, reasons }: { pct: number; reasons?: string[] }) {
  if (pct <= 0) return null;
  return (
    <div className="mt-3">
      <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: "rgba(146,166,255,0.14)" }}>
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${pct}%`, background: ACCENT, boxShadow: `0 0 8px rgba(255,140,90,0.5)` }}
        />
      </div>
      <div className="mt-1 text-[11px] text-dim" style={{ fontFamily: "var(--font-mono)" }}>
        Match {pct}% · {matchBand(pct)}
      </div>
      {reasons && reasons.length > 0 && (
        <div className="mt-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">Recommended because</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {reasons.map((r) => (
              <span key={r} className="rounded-full border border-line px-2 py-0.5 text-[11px] text-dim">
                {r}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
