"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "./LanguageProvider";
import BackButton from "./BackButton";
import LoadingIndicator from "./LoadingIndicator";

type OneOnOneInterviewType = "hr" | "technical" | "behavioral" | "mixed";
type HistoryInterviewType = OneOnOneInterviewType | "group";

type HistoryItem = {
  kind: "one_on_one" | "group";
  id: string;
  sessionId: string;
  company: string;
  jobTitle: string;
  interviewType: HistoryInterviewType;
  reportedAt: number;
  overallBand: number | null;
  reportKind?: "score" | "mbti" | "group";
  mbtiType?: string;
  weaknesses: string[];
  roundCount?: number;
  topicTitle?: string;
  hasReport?: boolean;
  phase?: string;
  status?: string;
};

type HistoryApiItem = Omit<HistoryItem, "kind" | "overallBand"> & {
  interviewType: OneOnOneInterviewType;
  overallBand: number;
  reportKind?: "score" | "mbti";
  roundCount: number;
};

type GroupHistoryApiItem = {
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

export default function HistoryRecordsPage() {
  const { language, t } = useI18n();
  const [records, setRecords] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [interviewType, setInterviewType] = useState<HistoryInterviewType | "all">("all");
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const timestamp = Date.now();
      const [historyRes, groupRes] = await Promise.all([
        fetch(`/api/history?t=${timestamp}`, { cache: "no-store" }),
        fetch(`/api/group/history?t=${timestamp}`, { cache: "no-store" }),
      ]);
      const historyJson = await historyRes.json();
      const groupJson = await groupRes.json();
      if (!historyRes.ok) throw new Error(historyJson.error || "加载历史面试记录失败");
      if (!groupRes.ok) throw new Error(groupJson.error || "加载群面历史记录失败");

      const oneOnOneRecords: HistoryItem[] = ((historyJson.records || []) as HistoryApiItem[]).map(
        (record) => ({
          ...record,
          kind: "one_on_one",
          overallBand: scoreToBand(record.overallBand),
          weaknesses: record.weaknesses || [],
        })
      );
      const groupRecords: HistoryItem[] = ((groupJson.records || []) as GroupHistoryApiItem[])
        .filter((record) => record.hasReport)
        .map((record): HistoryItem => ({
          kind: "group",
          id: record.id,
          sessionId: record.id,
          company: record.company,
          jobTitle: record.jobTitle,
          interviewType: "group",
          reportedAt: record.createdAt,
          overallBand: record.overallScore === null ? null : scoreToBand(record.overallScore),
          reportKind: "group",
          weaknesses: [],
          topicTitle: record.topicTitle,
          hasReport: record.hasReport,
          phase: record.phase,
          status: record.status,
        }));

      setRecords([...oneOnOneRecords, ...groupRecords].sort((a, b) => b.reportedAt - a.reportedAt));
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载历史面试记录失败");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(record: HistoryItem) {
    const confirmed = window.confirm(t("history.confirmDelete"));
    if (!confirmed) return;

    const id = record.id;
    setDeletingId(id);
    setError(null);
    try {
      const params = new URLSearchParams({ sessionId: record.sessionId });
      const deleteUrl =
        record.kind === "group"
          ? `/api/group/history/${encodeURIComponent(id)}`
          : `/api/history/${id}?${params.toString()}`;
      const res = await fetch(deleteUrl, {
        method: "DELETE",
        cache: "no-store",
        headers: { "Cache-Control": "no-store" },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) throw new Error(json.error || "删除历史面试记录失败");
      setRecords((current) => current.filter((item) => !isDeletedRecord(item, record)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除历史面试记录失败");
    } finally {
      setDeletingId(null);
    }
  }

  const empty = !loading && records.length === 0;
  const filteredRecords = useMemo(() => {
    return records.filter((record) => {
      const query = searchQuery.trim().toLowerCase();
      const recordDate = new Date(record.reportedAt);
      const dayStart = isValidDateInput(startDate) ? new Date(`${startDate}T00:00:00`) : null;
      const dayEnd = isValidDateInput(endDate) ? new Date(`${endDate}T23:59:59.999`) : null;
      const matchesQuery =
        !query ||
        [record.jobTitle, record.company, record.topicTitle || "", ...record.weaknesses]
          .join(" ")
          .toLowerCase()
          .includes(query);
      const matchesType = interviewType === "all" || record.interviewType === interviewType;
      const matchesStart = !dayStart || recordDate >= dayStart;
      const matchesEnd = !dayEnd || recordDate <= dayEnd;
      return matchesQuery && matchesType && matchesStart && matchesEnd;
    });
  }, [records, searchQuery, interviewType, startDate, endDate]);
  const noFilteredResults = !loading && !empty && filteredRecords.length === 0;

  return (
    <div className="space-y-6">
      <div className="sticky top-3 z-40 rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-lg backdrop-blur-md">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs text-slate-500">{t("history.kicker")}</div>
            <h1 className="text-2xl font-bold mb-2">{t("history.title")}</h1>
            <p className="text-sm text-slate-600">
              {t("history.description")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <BackButton fallbackHref="/?expanded=1" labelId="report.backHome" alwaysFallback />
            <Link
              href="/interview/choose"
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              {t("history.newInterview")}
            </Link>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setFiltersOpen((current) => !current)}
            aria-expanded={filtersOpen}
            className="flex items-center gap-2 text-sm font-medium text-slate-700"
          >
            <svg
              viewBox="0 0 24 24"
              className={`h-4 w-4 transition-transform ${filtersOpen ? "rotate-90" : ""}`}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m9 18 6-6-6-6" />
            </svg>
            {t("history.filterToggle")}
          </button>
          <div className="text-sm text-slate-600">
            {t("history.count", { shown: filteredRecords.length, total: records.length })}
          </div>
        </div>
        {filtersOpen && (
          <>
            <div className="grid gap-4 md:grid-cols-[1.5fr_repeat(3,minmax(0,1fr))]">
              <label className="space-y-1">
                <div className="text-xs font-medium text-slate-500">{t("history.search")}</div>
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder={t("history.searchPlaceholder")}
                  className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
              <label className="space-y-1">
                <div className="text-xs font-medium text-slate-500">{t("history.startDate")}</div>
                <input
                  value={startDate}
                  onChange={(event) => setStartDate(normalizeDateInput(event.target.value))}
                  placeholder="YYYY-MM-DD"
                  inputMode="numeric"
                  maxLength={10}
                  className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
              <label className="space-y-1">
                <div className="text-xs font-medium text-slate-500">{t("history.endDate")}</div>
                <input
                  value={endDate}
                  onChange={(event) => setEndDate(normalizeDateInput(event.target.value))}
                  placeholder="YYYY-MM-DD"
                  inputMode="numeric"
                  maxLength={10}
                  className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
              <label className="space-y-1">
                <div className="text-xs font-medium text-slate-500">{t("history.interviewType")}</div>
                <select
                  value={interviewType}
                  onChange={(event) =>
                    setInterviewType(event.target.value as HistoryInterviewType | "all")
                  }
                  className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
                >
                  <option value="all">{t("history.allTypes")}</option>
                  <option value="group">{interviewTypeLabel("group", t)}</option>
                  <option value="mixed">{interviewTypeLabel("mixed", t)}</option>
                  <option value="hr">{interviewTypeLabel("hr", t)}</option>
                  <option value="technical">{interviewTypeLabel("technical", t)}</option>
                  <option value="behavioral">{interviewTypeLabel("behavioral", t)}</option>
                </select>
              </label>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  setStartDate("");
                  setEndDate("");
                  setInterviewType("all");
                }}
                className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
              >
                {t("history.clear")}
              </button>
            </div>
          </>
        )}
      </div>

      {loading && <LoadingIndicator label={t("history.loading")} />}
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {empty && (
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="text-sm font-medium mb-2">{t("history.emptyTitle")}</div>
          <div className="text-sm text-slate-600 mb-4">
            {t("history.emptyDesc")}
          </div>
          <Link
            href="/interview/choose"
            className="inline-flex rounded-md bg-slate-900 px-4 py-2 text-sm text-white"
          >
            {t("history.startInterview")}
          </Link>
        </div>
      )}

      {noFilteredResults && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
          {t("history.noResults")}
        </div>
      )}

      {!empty && !noFilteredResults && (
        <div className="space-y-3">
          {filteredRecords.map((record) => {
            const reportHref =
              record.kind === "group"
                ? `/group/${record.sessionId}/report`
                : `/history/${record.id}`;

            return (
              <div
                key={`${record.kind}-${record.id}`}
                className="rounded-xl border border-slate-200 bg-white p-5"
              >
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex rounded-md px-2.5 py-1 text-sm font-medium ring-1 ${
                          record.kind === "group"
                            ? "bg-orange-50 text-orange-700 ring-orange-200"
                            : "bg-indigo-50 text-indigo-700 ring-indigo-200"
                        }`}
                      >
                        {record.jobTitle}
                      </span>
                      <span className="text-sm font-medium text-slate-800">{record.company}</span>
                      <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                        {interviewTypeLabel(record.interviewType, t)}
                      </span>
                    </div>
                    {record.topicTitle && (
                      <div className="mt-2 truncate text-sm text-slate-600">{record.topicTitle}</div>
                    )}
                    <div className="mt-1 text-xs text-slate-500">
                      {formatDate(record.reportedAt, language)}
                      {record.reportKind === "mbti"
                        ? ` · MBTI ${record.mbtiType || t("history.mbtiPending")}`
                        : record.overallBand !== null
                        ? ` · ${t("history.scoreMeta", {
                            score: record.overallBand.toFixed(1),
                            grade: gradeForBand(record.overallBand),
                          })}`
                        : record.kind === "group" && !record.hasReport
                        ? ` · ${t("history.reportPending")}`
                        : ""}
                      {typeof record.roundCount === "number"
                        ? ` · ${t("history.roundCount", { count: record.roundCount })}`
                        : ""}
                    </div>
                    {record.weaknesses.length > 0 && (
                      <div className="mt-2 text-sm text-slate-600">
                        <div className="mb-1">{t("history.mainIssues")}</div>
                        <ul className="list-disc pl-5 space-y-1">
                          {record.weaknesses.map((item, index) => (
                            <li key={index}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={reportHref}
                      className="inline-flex rounded-md bg-slate-900 px-4 py-2 text-sm text-white"
                    >
                      {t("history.viewReport")}
                    </Link>
                    <button
                      type="button"
                      onClick={() => handleDelete(record)}
                      disabled={deletingId === record.id}
                      className="inline-flex rounded-md border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700 disabled:opacity-50"
                    >
                      {deletingId === record.id ? t("history.deleting") : t("history.delete")}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function formatDate(timestamp: number, language: "zh" | "en") {
  return new Date(timestamp).toLocaleString(language === "en" ? "en-US" : "zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function scoreToBand(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const normalized = value > 9 ? (value / 100) * 9 : value;
  return Math.round(Math.max(0, Math.min(9, normalized)) * 2) / 2;
}

function gradeForBand(value: number): "A" | "B" | "C" | "D" | "E" | "F" {
  if (value >= 7) return "A";
  if (value >= 6) return "B";
  if (value >= 5) return "C";
  if (value >= 4) return "D";
  if (value >= 3) return "E";
  return "F";
}

function interviewTypeLabel(
  value: HistoryInterviewType,
  t: (key: string) => string
) {
  if (value === "group") return t("interviewChoice.group");
  return t(`type.${value}`);
}

function isDeletedRecord(item: HistoryItem, target: HistoryItem): boolean {
  if (target.kind === "group") {
    return item.kind === "group" && item.id === target.id;
  }
  return item.kind === "one_on_one" && (item.id === target.id || item.sessionId === target.sessionId);
}

function normalizeDateInput(value: string) {
  const digits = value.replace(/[^\d]/g, "").slice(0, 8);
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}

function isValidDateInput(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}
