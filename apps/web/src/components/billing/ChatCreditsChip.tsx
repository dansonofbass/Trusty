"use client";

/**
 * "N AI messages left" — the always-visible meter, so running out is never a
 * surprise. Tapping it opens the packs sheet (the same paywall the chat shows
 * on a 402), letting people top up before they're blocked.
 */
import { useCallback, useEffect, useState } from "react";
import { MessageCircle } from "lucide-react";
import { useT } from "@/lib/i18n";
import { getBilling, type BillingMe } from "@/lib/billingClient";
import { useUI } from "@/lib/store";
import CreditsPaywall from "./CreditsPaywall";

export default function ChatCreditsChip() {
  const t = useT();
  const [me, setMe] = useState<BillingMe | null>(null);
  const [open, setOpen] = useState(false);
  // Any finished agent turn bumps this — the balance stays honest without polling.
  const chatsNonce = useUI((s) => s.chatsNonce);

  const load = useCallback(() => {
    getBilling()
      .then(setMe)
      .catch(() => setMe(null));
  }, []);
  useEffect(() => {
    load();
  }, [load, chatsNonce]);

  if (!me || !me.enabled) return null;

  const low = me.balance <= 5;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t("credits.balanceLong", { count: me.balance })}
        className="flex w-full items-center gap-1.5 rounded-xl border px-2.5 py-2 text-[12px] font-medium transition"
        style={
          low
            ? { borderColor: "var(--color-accent-line)", background: "var(--color-accent-soft)", color: "var(--color-accent)" }
            : { borderColor: "var(--color-line)", color: "var(--color-dim)" }
        }
      >
        <MessageCircle size={13} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate text-start">{t("credits.title")}</span>
        <span className="tabular shrink-0 font-bold">{me.balance}</span>
      </button>

      {open && (
        <CreditsPaywall
          plans={me.plans}
          payment={me.payment}
          freeMonthly={me.freeMonthly}
          onClose={() => {
            setOpen(false);
            load();
          }}
        />
      )}
    </>
  );
}
