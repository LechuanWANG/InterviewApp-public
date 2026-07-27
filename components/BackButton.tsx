"use client";

import { useRouter } from "next/navigation";
import { useI18n } from "./LanguageProvider";

export default function BackButton({
  fallbackHref = "/",
  labelId = "common.back",
  alwaysFallback = false,
}: {
  fallbackHref?: string;
  labelId?: string;
  alwaysFallback?: boolean;
}) {
  const router = useRouter();
  const { t } = useI18n();

  function goBack() {
    if (!alwaysFallback && window.history.length > 1) {
      router.back();
      return;
    }
    router.push(fallbackHref);
  }

  return (
    <button
      type="button"
      onClick={goBack}
      className="inline-flex rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
    >
      {t(labelId)}
    </button>
  );
}
