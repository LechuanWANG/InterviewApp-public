"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useI18n } from "./LanguageProvider";
import LoadingIndicator from "./LoadingIndicator";

type GroupRecord = {
  id: string;
  company: string;
  jobTitle: string;
  topicTitle: string;
  phase: string;
  status: string;
  hasReport: boolean;
  overallScore: number | null;
  createdAt: number;
};

export default function GroupHistoryPage() {
  const { t, language } = useI18n();
  const [records, setRecords] = useState<GroupRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/group/history", { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "failed");
        if (active) {
          setRecords(((data.records || []) as GroupRecord[]).filter((record) => record.hasReport));
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "failed");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (loading) return <LoadingIndicator variant="block" label={t("group.loading")} />;
  if (error) return <div className="text-sm text-red-600">{error}</div>;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t("groupHistory.title")}</h1>
      {records.length === 0 ? (
        <div className="rounded-md border bg-white p-6 text-sm text-slate-500">{t("groupHistory.empty")}</div>
      ) : (
        <ul className="space-y-3">
          {records.map((r) => (
            <li key={r.id} className="rounded-xl border bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-slate-900">
                    {r.company} · {r.jobTitle}
                  </div>
                  <div className="mt-0.5 truncate text-sm text-slate-600">{r.topicTitle}</div>
                  <div className="mt-1 text-xs text-slate-400">
                    {new Date(r.createdAt).toLocaleString(language === "zh" ? "zh-CN" : "en-US")}
                    {r.overallScore !== null
                      ? ` · ${t("groupHistory.score")} ${scoreToBand(r.overallScore).toFixed(1)} / 9.0`
                      : ""}
                  </div>
                </div>
                <Link
                  href={`/group/${r.id}/report`}
                  className="shrink-0 rounded-md bg-violet-100 px-4 py-2 text-sm font-medium text-violet-800 hover:bg-violet-200"
                >
                  {t("groupHistory.viewReport")}
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function scoreToBand(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const normalized = value > 9 ? (value / 100) * 9 : value;
  return Math.round(Math.max(0, Math.min(9, normalized)) * 2) / 2;
}
