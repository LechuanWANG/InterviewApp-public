"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "./LanguageProvider";
import LoadingIndicator from "./LoadingIndicator";
import { saveConsultVoiceEnabled } from "@/lib/consultation/voicePreference";

/**
 * 直接开聊入口：进入即创建一个不绑定面试记录的战略咨询会话，然后跳转到聊天窗口。
 * 想做有证据的复盘时，用户可在对话里直接请求，由顾问按需调取面试记录。
 */
export default function ConsultStart() {
  const router = useRouter();
  const { t } = useI18n();
  const startedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void (async () => {
      try {
        const res = await fetch("/api/consult/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ selectedInterviewSessionIds: [], selectedGroupSessionIds: [] }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || t("consult.start.failed"));
        try {
          sessionStorage.setItem(`consult-new-entry:${json.consultId}`, "1");
          saveConsultVoiceEnabled(json.consultId, true);
        } catch {
          // sessionStorage 不可用不阻塞跳转。
        }
        router.replace(`/consult/${json.consultId}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : t("consult.start.failed"));
      }
    })();
  }, [router, t]);

  if (error) {
    return (
      <div className="space-y-4">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              startedRef.current = false;
              setError(null);
              router.refresh();
            }}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white"
          >
            {t("consult.start.retry")}
          </button>
          <button
            type="button"
            onClick={() => router.push("/?expanded=1")}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700"
          >
            {t("report.backHome")}
          </button>
        </div>
      </div>
    );
  }

  return <LoadingIndicator label={t("consult.start.creating")} />;
}
