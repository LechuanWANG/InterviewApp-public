"use client";

import { usePathname } from "next/navigation";
import { useI18n } from "./LanguageProvider";

export default function LanguageSwitcher() {
  const { language, setLanguage, t } = useI18n();
  const pathname = usePathname();

  // Only surfaced on the home page; every other screen keeps its own header.
  if (pathname !== "/") return null;

  return (
    <div className="fixed right-16 top-4 z-50 rounded-full border border-slate-200 bg-white/90 p-1 text-xs shadow-sm backdrop-blur">
      <span className="sr-only">{t("app.language")}</span>
      <button
        type="button"
        onClick={() => setLanguage("zh")}
        className={`rounded-full px-3 py-1.5 font-medium transition ${
          language === "zh" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
        }`}
      >
        {t("app.chinese")}
      </button>
      <button
        type="button"
        onClick={() => setLanguage("en")}
        className={`rounded-full px-3 py-1.5 font-medium transition ${
          language === "en" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
        }`}
      >
        {t("app.english")}
      </button>
    </div>
  );
}
