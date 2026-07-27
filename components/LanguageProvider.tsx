"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  UI_LANGUAGE_STORAGE_KEY,
  coerceUiLanguage,
  translate,
  type UiLanguage,
} from "@/lib/i18n";

type I18nContextValue = {
  language: UiLanguage;
  setLanguage: (language: UiLanguage) => void;
  t: (key: string, values?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<UiLanguage>("zh");

  useEffect(() => {
    const saved = window.localStorage.getItem(UI_LANGUAGE_STORAGE_KEY);
    setLanguageState(coerceUiLanguage(saved));
  }, []);

  const setLanguage = useCallback((nextLanguage: UiLanguage) => {
    setLanguageState(nextLanguage);
    window.localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, nextLanguage);
  }, []);

  useEffect(() => {
    document.documentElement.lang = language === "en" ? "en" : "zh-CN";
  }, [language]);

  const t = useCallback(
    (key: string, values?: Record<string, string | number>) => translate(language, key, values),
    [language]
  );

  const value = useMemo(() => ({ language, setLanguage, t }), [language, setLanguage, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used inside LanguageProvider");
  }
  return context;
}

export function UiText({
  id,
  values,
}: {
  id: string;
  values?: Record<string, string | number>;
}) {
  const { t } = useI18n();
  return <>{t(id, values)}</>;
}
