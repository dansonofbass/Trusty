/**
 * Trusty brand mark — the real logo: three glowing nodes joined by bars
 * forming a "T" constellation (crossbar of two nodes, stem down to a third).
 * Shared by the desktop TopBar, mobile header and invite landing so the mark
 * is defined exactly once.
 */
export function LogoMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      {/* soft glow under the nodes (cheap — no filters) */}
      <circle cx="4.5" cy="5" r="4" fill="#ffffff" opacity="0.16" />
      <circle cx="19.5" cy="5" r="4" fill="#ffffff" opacity="0.16" />
      <circle cx="12" cy="19" r="4" fill="#ffffff" opacity="0.16" />
      {/* bars: crossbar + stem */}
      <line x1="4.5" y1="5" x2="19.5" y2="5" stroke="#ffffff" strokeWidth="1.5" opacity="0.85" />
      <line x1="12" y1="5" x2="12" y2="19" stroke="#ffffff" strokeWidth="1.5" opacity="0.85" />
      {/* nodes */}
      <circle cx="4.5" cy="5" r="2.2" fill="#ffffff" />
      <circle cx="19.5" cy="5" r="2.2" fill="#ffffff" />
      <circle cx="12" cy="19" r="2.2" fill="#ffffff" />
    </svg>
  );
}

export default function Brand({
  wordmark = true,
  size = 24,
  className = "",
}: {
  wordmark?: boolean;
  size?: number;
  /** Extra classes on the wordmark text (e.g. "hidden lg:inline"). */
  className?: string;
}) {
  return (
    <div className="flex items-center gap-2.5 pl-1">
      <LogoMark size={size} />
      {wordmark && (
        <span
          className={`font-display text-[13px] font-bold uppercase tracking-[0.28em] text-ink ${className}`}
          style={{ fontFamily: "var(--font-display)" }}
        >
          Trusty
        </span>
      )}
    </div>
  );
}
