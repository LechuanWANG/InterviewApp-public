"use client";

import { useEffect, useState } from "react";
import { useI18n } from "./LanguageProvider";
import LoadingIndicator from "./LoadingIndicator";

type ConsultMemoryIssue = {
  id: string;
  normalizedKey: string;
  label: string;
  category: "common" | "single";
  sourceTypes: Array<"consultation" | "interview_report">;
  sourceIds: string[];
  sourceTitles: string[];
  occurrenceCount: number;
  lastSeenAt: number;
  resolved: boolean;
};

type IssuePayload = {
  commonIssues: ConsultMemoryIssue[];
  singleInterviewIssues: ConsultMemoryIssue[];
  resolvedIssues: ConsultMemoryIssue[];
};

export default function ConsultIssuesPage() {
  const { language, t } = useI18n();
  const [data, setData] = useState<IssuePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatingKey, setUpdatingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/consult/issues", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "加载共性问题失败");
      setData(json as IssuePayload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载共性问题失败");
    } finally {
      setLoading(false);
    }
  }

  async function updateIssue(issue: ConsultMemoryIssue, action: "resolve" | "restore") {
    setUpdatingKey(issue.normalizedKey);
    setError(null);
    try {
      const res = await fetch("/api/consult/issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          normalizedKey: issue.normalizedKey,
          label: issue.label,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "更新问题记忆失败");
      setData(json as IssuePayload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新问题记忆失败");
    } finally {
      setUpdatingKey(null);
    }
  }

  const empty = !loading &&
    !data?.commonIssues.length &&
    !data?.resolvedIssues.length;

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs text-slate-500">{t("consultIssues.kicker")}</div>
        <h1 className="text-2xl font-bold mb-2">{t("consultIssues.title")}</h1>
        <p className="text-sm text-slate-600 max-w-2xl">{t("consultIssues.description")}</p>
      </div>

      {loading && <LoadingIndicator label={t("consultIssues.loading")} />}
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}
      {empty && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
          {t("consultIssues.empty")}
        </div>
      )}

      {data && (
        <>
          <IssueSection
            title={t("consultIssues.common")}
            description={t("consultIssues.commonDesc")}
            issues={data.commonIssues}
            actionLabel={t("consultIssues.resolve")}
            updatingKey={updatingKey}
            language={language}
            onAction={(issue) => updateIssue(issue, "resolve")}
          />
          <IssueSection
            title={t("consultIssues.resolved")}
            description={t("consultIssues.resolvedDesc")}
            issues={data.resolvedIssues}
            actionLabel={t("consultIssues.restore")}
            updatingKey={updatingKey}
            language={language}
            onAction={(issue) => updateIssue(issue, "restore")}
            muted
          />
        </>
      )}
    </div>
  );
}

function IssueSection({
  title,
  description,
  issues,
  actionLabel,
  updatingKey,
  language,
  muted = false,
  onAction,
}: {
  title: string;
  description: string;
  issues: ConsultMemoryIssue[];
  actionLabel: string;
  updatingKey: string | null;
  language: "zh" | "en";
  muted?: boolean;
  onAction: (issue: ConsultMemoryIssue) => void;
}) {
  if (!issues.length) return null;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-4">
        <div className="text-sm font-semibold text-slate-900">{title}</div>
        <div className="mt-1 text-xs text-slate-500">{description}</div>
      </div>
      <div className="space-y-3">
        {issues.map((issue) => (
          <div
            key={issue.normalizedKey}
            className={`rounded-lg border p-4 ${muted ? "border-slate-100 bg-slate-50" : "border-slate-200 bg-white"}`}
          >
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-slate-900">{issue.label}</div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5">
                    {language === "en" ? `${issue.occurrenceCount} occurrences` : `出现 ${issue.occurrenceCount} 次`}
                  </span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5">
                    {formatDate(issue.lastSeenAt, language)}
                  </span>
                </div>
                {issue.sourceTitles.length > 0 && (
                  <div className="mt-2 text-xs leading-5 text-slate-500">
                    {language === "en" ? "Sources: " : "来源："}
                    {issue.sourceTitles.slice(0, 4).join("；")}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => onAction(issue)}
                disabled={updatingKey === issue.normalizedKey}
                className={`shrink-0 rounded-md px-4 py-2 text-sm disabled:opacity-50 ${
                  muted
                    ? "border border-slate-200 bg-white text-slate-700"
                    : "bg-slate-900 text-white"
                }`}
              >
                {updatingKey === issue.normalizedKey ? (language === "en" ? "Updating…" : "更新中…") : actionLabel}
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function formatDate(timestamp: number, language: "zh" | "en") {
  return new Date(timestamp).toLocaleDateString(language === "en" ? "en-US" : "zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}
