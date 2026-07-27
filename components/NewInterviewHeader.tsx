"use client";

import { useEffect, useState } from "react";
import { useI18n } from "./LanguageProvider";
import { readInterviewFormat, type InterviewFormat } from "@/lib/interviewFormat";

export default function NewInterviewHeader() {
  const { t } = useI18n();
  const [format, setFormat] = useState<InterviewFormat | null>(null);

  useEffect(() => {
    setFormat(readInterviewFormat());
  }, []);

  if (!format) {
    return (
      <div>
        <div className="text-xs text-slate-500">{t("newInterview.loadingKicker")}</div>
        <h1 className="text-2xl font-bold mb-2">{t("newInterview.loadingTitle")}</h1>
        <p className="text-sm text-slate-600">{t("newInterview.loadingDescription")}</p>
      </div>
    );
  }

  const prefix = format === "group" ? "newInterview.group" : "newInterview";

  return (
    <div>
      <div className="text-xs text-slate-500">{t(`${prefix}.kicker`)}</div>
      <h1 className="text-2xl font-bold mb-2">{t(`${prefix}.title`)}</h1>
      <p className="text-sm text-slate-600">{t(`${prefix}.description`)}</p>
    </div>
  );
}
