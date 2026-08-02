"use client";

/**
 * i18n — one provider, one hook, one dictionary file.
 *
 *   const t = useT();
 *   <h1>{t("community.title")}</h1>
 *   <p>{t("credits.balance", { count: 12 })}</p>
 *
 * Locale resolution (first hit wins): explicit user choice (localStorage) →
 * the Space's default (irham → Persian) → English. Direction (rtl/ltr) is
 * applied to <html> by the provider, so components never branch on language
 * for layout — write LOGICAL CSS (ms-*, me-*, text-start) and RTL follows.
 *
 * Keys are typed against the English dictionary: a typo or a key missing from
 * a locale fails the build instead of leaking English into Persian UI.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { DICTIONARIES, LOCALES, en, type Locale, type TranslationKey } from "./dictionaries";
import { spaceFromHost } from "@/lib/space";

const STORAGE_KEY = "trusty-locale";

/** Spaces whose audience reads Persian by default. */
const SPACE_DEFAULT_LOCALE: Record<string, Locale> = { irham: "fa" };

export type Translate = (key: TranslationKey, vars?: Record<string, string | number>) => string;

interface I18nValue {
  locale: Locale;
  dir: "ltr" | "rtl";
  setLocale: (l: Locale) => void;
  t: Translate;
}

const I18nContext = createContext<I18nValue | null>(null);

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

/** SSR-safe default so the first paint isn't wrong for Persian spaces. */
function initialLocale(): Locale {
  if (typeof window === "undefined") return "en";
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "en" || stored === "fa") return stored;
  const space = spaceFromHost();
  return (space && SPACE_DEFAULT_LOCALE[space]) || "en";
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  // Start at "en" on both server and first client render (hydration-safe),
  // then adopt the resolved locale immediately after mount.
  const [locale, setLocaleState] = useState<Locale>("en");
  useEffect(() => setLocaleState(initialLocale()), []);

  const dir = LOCALES.find((l) => l.code === locale)?.dir ?? "ltr";

  // The document element owns direction + lang — one place, no per-component
  // branching, and native form controls/scrollbars flip correctly.
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = dir;
  }, [locale, dir]);

  const setLocale = useCallback((l: Locale) => {
    localStorage.setItem(STORAGE_KEY, l);
    setLocaleState(l);
  }, []);

  const t = useCallback<Translate>(
    (key, vars) => interpolate(DICTIONARIES[locale][key] ?? en[key] ?? key, vars),
    [locale],
  );

  const value = useMemo<I18nValue>(() => ({ locale, dir, setLocale, t }), [locale, dir, setLocale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Full i18n handle (locale, direction, switcher). */
export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (ctx) return ctx;
  // Outside the provider (isolated component tests, edge cases): English,
  // no crash.
  return {
    locale: "en",
    dir: "ltr",
    setLocale: () => {},
    t: (key, vars) => interpolate(en[key] ?? key, vars),
  };
}

/** The common case: just translate. */
export function useT(): Translate {
  return useI18n().t;
}

export { LOCALES };
export type { Locale, TranslationKey };
