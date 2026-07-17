"use client";

import * as React from "react";
import { dictionaries, type Lang } from "./dictionary";

const STORAGE_KEY = "deskly_lang";

type TranslateParams = Record<string, string | number>;
type I18nValue = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string, params?: TranslateParams) => string;
};

const I18nContext = React.createContext<I18nValue | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  // Start "en" for a deterministic SSR/first paint; apply the stored choice
  // after mount to avoid a hydration mismatch.
  const [lang, setLangState] = React.useState<Lang>("en");

  React.useEffect(() => {
    try {
      const stored = window.localStorage?.getItem(STORAGE_KEY);
      if (stored === "en" || stored === "th") setLangState(stored);
    } catch {
      // localStorage unavailable (SSR / private mode / test env) — stay default
    }
  }, []);

  React.useEffect(() => {
    if (typeof document !== "undefined") document.documentElement.lang = lang;
  }, [lang]);

  const setLang = React.useCallback((next: Lang) => {
    setLangState(next);
    try {
      window.localStorage?.setItem(STORAGE_KEY, next);
    } catch {
      // ignore (private mode etc.)
    }
  }, []);

  const t = React.useCallback(
    (key: string, params?: TranslateParams) => {
      let str = dictionaries[lang][key] ?? dictionaries.en[key] ?? key;
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          str = str.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
        }
      }
      return str;
    },
    [lang],
  );

  const value = React.useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = React.useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within LanguageProvider");
  return ctx;
}
