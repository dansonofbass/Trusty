"use client";

/**
 * CommunityHome — the Iranians-in-Armenia (irham) front door. Same lesson as
 * SummitHome: newcomers from a Telegram share link expect buttons, not a
 * conversation. Six bilingual actions + three tappable example questions; the
 * chat input stays right below (typing anything runs the agent, which answers
 * in Persian when asked in Persian).
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MessageCircle, MessagesSquare, QrCode, ScanLine, UserPlus, X } from "lucide-react";
import { QRShare, QRScan } from "@/components/summit/QRConnect";
import { fetchCircles, joinCircle, type CircleSummary } from "@/lib/socialClient";
import { useGraphData } from "@/lib/graph/GraphDataProvider";
import { useUI } from "@/lib/store";

const EXAMPLES: { en: string; fa: string; prompt: string }[] = [
  { en: "Residency documents", fa: "مدارک اقامت", prompt: "What documents do I need for the residency application?" },
  { en: "A trusted accountant", fa: "حسابدار قابل‌اعتماد", prompt: "Find a trusted accountant for my IE" },
  { en: "Which bank works now?", fa: "کدام بانک حساب باز می‌کند؟", prompt: "Which bank is currently opening accounts for Iranians?" },
];

export default function CommunityHome({ onAsk }: { onAsk: (prompt: string) => void }) {
  const router = useRouter();
  const { data } = useGraphData();
  const select = useUI((s) => s.select);
  const setRightPanel = useUI((s) => s.setRightPanel);

  const meId = data?.meId ?? null;
  const meLabel = data?.nodes.find((n) => n.id === meId)?.label ?? "You";

  const [qr, setQr] = useState<null | "share" | "scan">(null);
  const [circlesOpen, setCirclesOpen] = useState(false);
  const [circles, setCircles] = useState<CircleSummary[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!circlesOpen || circles) return;
    fetchCircles().then((r) => setCircles(r.circles)).catch(() => setCircles([]));
  }, [circlesOpen, circles]);

  const enterCircle = async (c: CircleSummary) => {
    if (c.mine) {
      router.push(`/messages?room=${encodeURIComponent(c.roomId)}`);
      return;
    }
    setBusyId(c.id);
    try {
      await joinCircle(c.id);
      router.push(`/messages?room=${encodeURIComponent(c.roomId)}`);
    } catch {
      setBusyId(null);
    }
  };

  const bigBtn = (icon: React.ReactNode, en: string, fa: string, onClick: () => void, accent = false) => (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[84px] flex-col items-start justify-between rounded-2xl border p-3.5 text-left transition active:scale-[0.98]"
      style={accent
        ? { borderColor: "var(--color-accent-line)", background: "var(--color-accent-soft)" }
        : { borderColor: "var(--color-line)", background: "var(--color-surface)" }}
    >
      <span style={{ color: accent ? "var(--color-accent)" : "var(--color-dim)" }}>{icon}</span>
      <span className="w-full">
        <span className="block text-[13.5px] font-bold leading-tight text-ink">{en}</span>
        <span dir="rtl" className="block text-[11.5px] leading-tight text-[var(--color-faint)]">{fa}</span>
      </span>
    </button>
  );

  return (
    <div className="mx-auto w-full max-w-[560px]">
      <h1 className="text-center text-[22px] font-bold leading-tight text-ink md:text-[26px]" style={{ fontFamily: "var(--font-display)" }}>
        🤝 Iranians in Armenia
      </h1>
      <p dir="rtl" className="mt-1 text-center text-[13.5px] leading-relaxed text-[var(--color-dim)]">
        سوال‌هایت را از کسانی بپرس که خودشان تجربه کرده‌اند
      </p>
      <p className="mb-4 text-center text-[11.5px] text-[var(--color-faint)]">
        Ask people who've actually been through it.
      </p>

      <div className="grid grid-cols-2 gap-2">
        {bigBtn(<MessagesSquare size={20} />, "Join circles", "حلقه‌ها — اقامت، مالیات، بانک…", () => setCirclesOpen((v) => !v), true)}
        {bigBtn(<MessageCircle size={20} />, "Ask anything", "هر سوالی بپرس", () => onAsk(""))}
        {bigBtn(<QrCode size={20} />, "My QR", "کارت من", () => setQr("share"))}
        {bigBtn(<ScanLine size={20} />, "Scan someone", "اسکن", () => setQr("scan"))}
        {bigBtn(<UserPlus size={20} />, "Invite friends", "دعوت دوستان", () => setRightPanel("invite"))}
        {bigBtn(<MessagesSquare size={20} />, "My groups", "گروه‌های من", () => router.push("/messages"))}
      </div>

      {/* Circles inline list — the #1 first action */}
      {circlesOpen && (
        <div className="mt-3 rounded-2xl border border-line bg-[var(--color-surface)] p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[12px] font-bold uppercase tracking-[0.12em] text-[var(--color-faint)]">Circles · حلقه‌ها</span>
            <button type="button" onClick={() => setCirclesOpen(false)} aria-label="Close">
              <X size={14} className="text-[var(--color-faint)]" />
            </button>
          </div>
          {!circles ? (
            <p className="py-3 text-center text-[12px] text-[var(--color-faint)]"><Loader2 size={14} className="inline animate-spin" /></p>
          ) : circles.length === 0 ? (
            <p className="py-2 text-[12px] text-[var(--color-dim)]">No circles yet — be the first to create one in Messages.</p>
          ) : (
            <ul className="space-y-1.5">
              {circles.map((c) => (
                <li key={c.id} className="flex items-center gap-2.5 rounded-xl border border-line px-2.5 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-semibold text-ink">{c.label}</span>
                      <span className="text-[10px] text-[var(--color-faint)]">{c.memberCount} member{c.memberCount === 1 ? "" : "s"}</span>
                    </span>
                    {c.description && (
                      <span dir="auto" className="mt-0.5 block truncate text-[11px] text-[var(--color-dim)]">{c.description}</span>
                    )}
                  </span>
                  <button
                    type="button"
                    disabled={busyId === c.id || (!c.open && !c.mine)}
                    onClick={() => void enterCircle(c)}
                    className="shrink-0 rounded-full px-3 py-1.5 text-[11.5px] font-bold transition disabled:opacity-40"
                    style={c.mine
                      ? { background: "rgba(146,166,255,0.12)", color: "var(--color-ink)" }
                      : { background: "var(--color-accent)", color: "var(--color-on-accent)" }}
                  >
                    {c.mine ? "Open" : c.open ? (busyId === c.id ? "…" : "Join") : "Invite-only"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Example questions — tap to run a real agent turn */}
      <div className="mt-3 space-y-1.5">
        {EXAMPLES.map((e) => (
          <button
            key={e.en}
            type="button"
            onClick={() => onAsk(e.prompt)}
            className="flex w-full items-center justify-between gap-3 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3.5 py-2.5 text-left transition hover:border-[var(--color-accent-line)]"
          >
            <span className="text-[12.5px] font-semibold text-ink">{e.en}</span>
            <span dir="rtl" className="text-[12px] text-[var(--color-faint)]">{e.fa}</span>
          </button>
        ))}
      </div>

      <p className="mt-4 text-center text-[11px] text-[var(--color-faint)]">
        Or type below — Persian works. · فارسی هم می‌فهمد
      </p>

      {qr === "share" && meId && <QRShare nodeId={meId} label={meLabel} onClose={() => setQr(null)} path="/" brand="Trusty" />}
      {qr === "scan" && (
        <QRScan
          onFound={(id) => {
            setQr(null);
            select(id);
          }}
          onClose={() => setQr(null)}
        />
      )}
    </div>
  );
}
