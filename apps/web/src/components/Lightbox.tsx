"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Full-screen image viewer with keyboard (←/→/Esc), on-screen arrows, a
 * thumbnail strip, and touch swipe (left → next, right → prev). Reused by the
 * client place modal and the admin place manager. Controlled by the caller:
 * render it when `photos` is non-empty and provide `onClose`.
 */
export default function Lightbox({
  photos,
  startIndex = 0,
  onClose,
}: {
  photos: string[];
  startIndex?: number;
  onClose: () => void;
}) {
  const [i, setI] = useState(Math.min(startIndex, Math.max(0, photos.length - 1)));
  const touchX = useRef<number | null>(null);

  const prev = useCallback(() => setI((n) => (n - 1 + photos.length) % photos.length), [photos.length]);
  const next = useCallback(() => setI((n) => (n + 1) % photos.length), [photos.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, prev, next]);

  if (!photos.length) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex flex-col items-center justify-center bg-black/92 backdrop-blur-sm"
      onClick={onClose}
      onTouchStart={(e) => { touchX.current = e.touches[0]?.clientX ?? null; }}
      onTouchEnd={(e) => {
        if (touchX.current == null) return;
        const dx = (e.changedTouches[0]?.clientX ?? 0) - touchX.current;
        if (dx < -45) next();
        else if (dx > 45) prev();
        touchX.current = null;
      }}
    >
      <button
        onClick={onClose}
        aria-label="Close"
        className="absolute right-4 top-4 z-10 rounded-full bg-white/10 p-2 text-white/90 hover:bg-white/20"
      >
        <X size={20} />
      </button>

      {photos.length > 1 && (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); prev(); }}
            aria-label="Previous"
            className="absolute left-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-2.5 text-white/90 hover:bg-white/20 sm:left-6"
          >
            <ChevronLeft size={24} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); next(); }}
            aria-label="Next"
            className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-2.5 text-white/90 hover:bg-white/20 sm:right-6"
          >
            <ChevronRight size={24} />
          </button>
        </>
      )}

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={photos[i]}
        alt={`Photo ${i + 1} of ${photos.length}`}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[82vh] max-w-[94vw] rounded-lg object-contain shadow-2xl"
      />

      <div className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2" onClick={(e) => e.stopPropagation()}>
        {photos.length > 1 && (
          <div className="mb-2 flex max-w-[94vw] gap-1.5 overflow-x-auto px-2 scroll-quiet">
            {photos.map((src, k) => (
              <button
                key={k}
                onClick={() => setI(k)}
                aria-label={`Go to photo ${k + 1}`}
                className="shrink-0 overflow-hidden rounded-md ring-2 transition"
                style={{ borderColor: "transparent", boxShadow: k === i ? "0 0 0 2px #ffd97a" : "none" }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="" className="h-12 w-16 object-cover opacity-80 hover:opacity-100" style={{ opacity: k === i ? 1 : 0.6 }} />
              </button>
            ))}
          </div>
        )}
        <div className="text-center text-[12px] text-white/70">{i + 1} / {photos.length}</div>
      </div>
    </div>
  );
}
