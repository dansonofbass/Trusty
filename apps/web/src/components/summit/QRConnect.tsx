"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import jsQR from "jsqr";
import { X, ScanLine, QrCode as QrIcon } from "lucide-react";

/**
 * QR Connect (F4) — the business-card replacement. "My QR" shows a scannable
 * deep link (/summit?connect=<id>); "Scan" reads another attendee's code and
 * opens their profile with a one-tap Connect. The deep link also works with no
 * camera at all (share/NFC/tap) — camera needs HTTPS or localhost.
 */

export function QRShare({ nodeId, label, onClose }: { nodeId: string; label: string; onClose: () => void }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const link = typeof window !== "undefined" ? `${window.location.origin}/summit?connect=${encodeURIComponent(nodeId)}` : "";

  useEffect(() => {
    if (!link) return;
    QRCode.toDataURL(link, { width: 480, margin: 2, color: { dark: "#070b18", light: "#e9edff" } })
      .then(setDataUrl)
      .catch(() => setDataUrl(null));
  }, [link]);

  const share = () => {
    if (navigator.share) void navigator.share({ title: "Trusty Sevan", text: `Connect with ${label}`, url: link }).catch(() => {});
    else void navigator.clipboard?.writeText(link);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#070b18f2] p-6 backdrop-blur-md" onClick={onClose}>
      <button type="button" onClick={onClose} className="absolute right-5 top-5 text-dim hover:text-ink"><X size={22} /></button>
      <div className="text-center" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#ff8c5a]">Trusty Sevan</div>
        <h2 className="mb-5 text-lg font-bold text-ink" style={{ fontFamily: "var(--font-display)" }}>{label}</h2>
        {dataUrl ? (
          <img src={dataUrl} alt="Your connect QR" className="mx-auto w-64 rounded-2xl border border-line" />
        ) : (
          <div className="mx-auto grid h-64 w-64 place-items-center rounded-2xl border border-line text-sm text-faint">generating…</div>
        )}
        <p className="mt-4 text-xs text-dim">Scan to connect — no business card needed.</p>
        <button type="button" onClick={share} className="mt-3 rounded-xl border border-line px-4 py-2 text-sm text-dim hover:text-ink">
          Share link instead
        </button>
      </div>
    </div>
  );
}

export function QRScan({ onFound, onClose }: { onFound: (nodeId: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const stopRef = useRef(false);

  const tick = useCallback(() => {
    if (stopRef.current) return;
    const video = videoRef.current;
    if (video && video.readyState === video.HAVE_ENOUGH_DATA) {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const g = canvas.getContext("2d");
      if (g) {
        g.drawImage(video, 0, 0);
        const img = g.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
        const m = code?.data.match(/[?&]connect=([^&]+)/);
        if (m) {
          stopRef.current = true;
          onFound(decodeURIComponent(m[1]));
          return;
        }
      }
    }
    requestAnimationFrame(tick);
  }, [onFound]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    stopRef.current = false;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "environment" } })
      .then((s) => {
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          void videoRef.current.play();
          requestAnimationFrame(tick);
        }
      })
      .catch(() => setErr("Camera unavailable — ask them to share their link instead."));
    return () => {
      stopRef.current = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [tick]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#070b18f2] p-6 backdrop-blur-md">
      <button type="button" onClick={onClose} className="absolute right-5 top-5 z-10 text-dim hover:text-ink"><X size={22} /></button>
      <div className="mb-3 flex items-center gap-2 text-sm text-dim"><ScanLine size={16} className="text-[#ff8c5a]" /> Point at a Trusty Sevan QR</div>
      {err ? (
        <p className="max-w-xs text-center text-sm text-rose-300">{err}</p>
      ) : (
        <video ref={videoRef} playsInline muted className="w-full max-w-sm rounded-2xl border border-line" />
      )}
    </div>
  );
}

/** Me-tab entry buttons for QR connect. */
export function QRButtons({ onShare, onScan }: { onShare: () => void; onScan: () => void }) {
  return (
    <div className="mb-4 grid grid-cols-2 gap-2">
      <button type="button" onClick={onShare}
        className="flex items-center justify-center gap-2 rounded-xl border border-line py-3 text-sm font-semibold text-ink hover:border-[#ff8c5a]/50">
        <QrIcon size={16} className="text-[#ff8c5a]" /> My QR
      </button>
      <button type="button" onClick={onScan}
        className="flex items-center justify-center gap-2 rounded-xl border border-line py-3 text-sm font-semibold text-ink hover:border-[#ff8c5a]/50">
        <ScanLine size={16} className="text-[#ff8c5a]" /> Scan
      </button>
    </div>
  );
}
