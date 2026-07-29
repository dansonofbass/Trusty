"use client";

/**
 * QR connect in the workspace shell — the business-card replacement, ported
 * from the summit edition. "My QR" encodes /?connect=<meId>; scanning someone
 * else's code opens their profile (Inspector / mobile sheet) where you save
 * the contact and follow up later.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { QrCode as QrIcon, ScanLine } from "lucide-react";
import { QRShare, QRScan } from "@/components/summit/QRConnect";
import { useGraphData } from "@/lib/graph/GraphDataProvider";
import { useUI } from "@/lib/store";

export default function QRConnectHost({ compact }: { compact?: boolean }) {
  const { data } = useGraphData();
  const select = useUI((s) => s.select);
  const router = useRouter();
  const [mode, setMode] = useState<null | "share" | "scan">(null);

  const meId = data?.meId;
  const meLabel = data?.nodes.find((n) => n.id === meId)?.label ?? "You";
  if (!meId) return null;

  const btn = (label: string, icon: React.ReactNode, onClick: () => void) =>
    compact ? (
      <button
        type="button"
        onClick={onClick}
        title={label}
        aria-label={label}
        className="rounded-lg border border-line p-1.5 text-[var(--color-faint)] transition hover:text-ink"
      >
        {icon}
      </button>
    ) : (
      <button
        type="button"
        onClick={onClick}
        className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-[var(--color-line)] py-2 text-[12px] font-medium text-[var(--color-dim)] transition hover:border-[var(--color-accent-line)] hover:text-ink"
      >
        {icon} {label}
      </button>
    );

  return (
    <>
      {compact ? (
        <>
          {btn("My QR", <QrIcon size={14} />, () => setMode("share"))}
          {btn("Scan QR", <ScanLine size={14} />, () => setMode("scan"))}
        </>
      ) : (
        <div className="mb-2 flex gap-2">
          {btn("My QR", <QrIcon size={13} style={{ color: "var(--color-accent)" }} />, () => setMode("share"))}
          {btn("Scan", <ScanLine size={13} style={{ color: "var(--color-accent)" }} />, () => setMode("scan"))}
        </div>
      )}
      {mode === "share" && (
        <QRShare nodeId={meId} label={meLabel} brand="Trusty" path="/" onClose={() => setMode(null)} />
      )}
      {mode === "scan" && (
        <QRScan
          onFound={(nodeId) => {
            setMode(null);
            select(nodeId); // Inspector (desktop) / sheet (mobile graph) opens with save/connect
            router.push("/");
          }}
          onClose={() => setMode(null)}
        />
      )}
    </>
  );
}
