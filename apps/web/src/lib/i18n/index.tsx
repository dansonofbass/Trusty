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

/**
 * The app's default language when nothing else decides — Persian, because the
 * only live community is Persian-speaking and the apex now resolves to it.
 *
 * Stamped on <html> by the root layout so the FIRST PAINT is already Persian
 * and RTL, rather than flashing an English LTR frame before the client
 * rehydrates. Anyone who picks English gets it, and keeps it (localStorage).
 */
export const DEFAULT_LOCALE: Locale = "fa";

/** Direction per locale — needed on the server, where LOCALES' shape is
 *  inconvenient and the provider hasn't run yet. */
export const LOCALE_DIR: Record<Locale, "ltr" | "rtl"> = { en: "ltr", fa: "rtl" };

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

/** Explicit choice → the space's own default → the app default. */
function initialLocale(): Locale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "en" || stored === "fa") return stored;
  const space = spaceFromHost();
  return (space && SPACE_DEFAULT_LOCALE[space]) || DEFAULT_LOCALE;
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  // Server and first client render both use DEFAULT_LOCALE — the same value the
  // root layout stamped on <html> — so hydration matches and there is no
  // English flash. A stored preference is adopted right after mount.
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
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
  // Outside the provider (isolated component tests, edge cases): fall back to
  // the app default rather than English, so a component mounted off-tree can't
  // quietly leak English into a Persian screen.
  return {
    locale: DEFAULT_LOCALE,
    dir: LOCALE_DIR[DEFAULT_LOCALE],
    setLocale: () => {},
    t: (key, vars) => interpolate(DICTIONARIES[DEFAULT_LOCALE][key] ?? en[key] ?? key, vars),
  };
}

/** The common case: just translate. */
export function useT(): Translate {
  return useI18n().t;
}

export { LOCALES };
export type { Locale, TranslationKey };
