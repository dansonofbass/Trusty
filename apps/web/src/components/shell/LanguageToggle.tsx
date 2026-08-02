"use client";

import { Languages } from "lucide-react";
import { LOCALES, useI18n } from "@/lib/i18n";

/** Two-language switch (English ⇄ فارسی). Sits in the sidebar footer. */
export default function LanguageToggle() {
  const { locale, setLocale } = useI18n();

  return (
    <div className="flex items-center gap-1.5 px-1">
      <Languages size={12} className="shrink-0 text-[var(--color-faint)]" />
      <div className="flex flex-1 gap-1">
        {LOCALES.map((l) => (
          <button
            key={l.code}
            type="button"
            onClick={() => setLocale(l.code)}
            className="flex-1 rounded-lg px-2 py-1 text-[11.5px] font-semibold transition"
            style={
              locale === l.code
                ? { background: "var(--color-accent-soft)", color: "var(--color-accent)" }
                : { color: "var(--color-faint)" }
            }
          >
            {l.label}
          </button>
        ))}
      </div>
    </div>
  );
}
