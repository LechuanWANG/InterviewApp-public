"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "./LanguageProvider";
import BackButton from "./BackButton";
import LoadingIndicator, { LoadingDots } from "./LoadingIndicator";

type ConsultHistoryItem = {
  id: string;
  goal: "common_issues" | "direction_judgement" | "practice_plan" | "single_review" | "open_chat";
  status: "active" | "stopped" | "completed";
  summaryMode: "single_session" | "multi_session";
  createdAt: number;
  updatedAt: number;
  endedAt: number | null;
  messageCount: number;
  latestJudgement: string | null;
  lastMessagePreview: string;
  selectedRecords: Array<{
    id: string;
    company: string;
    jobTitle: string;
    interviewType: "hr" | "technical" | "behavioral" | "mixed";
    overallBand: number;
    reportedAt: number;
  }>;
};

export default function ConsultHistoryPage() {
  const router = useRouter();
  const { language, t } = useI18n();
  const [sessions, setSessions] = useState<ConsultHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [continuingId, setContinuingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [consultType, setConsultType] = useState<ConsultHistoryItem["goal"] | "all">("all");
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/consult/history?t=${Date.now()}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "加载战略咨询历史失败");
      setSessions((json.sessions || []) as ConsultHistoryItem[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载战略咨询历史失败");
    } finally {
      setLoading(false);
    }
  }

  async function continueConsult(sessionId: string) {
    setContinuingId(sessionId);
    setError(null);
    try {
      const res = await fetch(`/api/consult/${sessionId}/resume`, { method: "POST" });
      const json = await res.json();
      if (res.status === 404) {
        setSessions((current) => current.filter((item) => item.id !== sessionId));
        throw new Error(json.error || "这条战略咨询记录已不存在，已从列表移除。");
      }
      if (!res.ok) throw new Error(json.error || "恢复战略咨询失败");
      router.push(`/consult/${sessionId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "恢复战略咨询失败");
      setContinuingId(null);
    }
  }

  async function viewConsult(sessionId: string) {
    setContinuingId(sessionId);
    setError(null);
    try {
      const res = await fetch(`/api/consult/${sessionId}?t=${Date.now()}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (res.status === 404) {
        setSessions((current) => current.filter((item) => item.id !== sessionId));
        throw new Error(json.error || "这条战略咨询记录已不存在，已从列表移除。");
      }
      if (!res.ok) throw new Error(json.error || "打开战略咨询失败");
      router.push(`/consult/${sessionId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "打开战略咨询失败");
      setContinuingId(null);
    }
  }

  async function deleteConsult(sessionId: string) {
    const confirmed = window.confirm(t("consultHistory.confirmDelete"));
    if (!confirmed) return;

    setDeletingId(sessionId);
    setError(null);
    try {
      const res = await fetch(`/api/consult/${sessionId}`, {
        method: "DELETE",
        cache: "no-store",
        headers: { "Cache-Control": "no-store" },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "删除战略咨询记录失败");
      setSessions((current) => current.filter((item) => item.id !== sessionId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除战略咨询记录失败");
    } finally {
      setDeletingId(null);
    }
  }

  const empty = !loading && sessions.length === 0;
  const filteredSessions = useMemo(() => {
    return sessions.filter((session) => {
      const query = searchQuery.trim().toLowerCase();
      const sessionDate = new Date(session.updatedAt || session.createdAt);
      const dayStart = isValidDateInput(startDate) ? new Date(`${startDate}T00:00:00`) : null;
      const dayEnd = isValidDateInput(endDate) ? new Date(`${endDate}T23:59:59.999`) : null;
      const textHaystack = [
        goalLabel(session.goal, t),
        session.latestJudgement || "",
        session.lastMessagePreview || "",
        ...session.selectedRecords.flatMap((record) => [record.jobTitle, record.company]),
      ]
        .join(" ")
        .toLowerCase();
      const matchesQuery = !query || textHaystack.includes(query);
      const matchesType = consultType === "all" || session.goal === consultType;
      const matchesStart = !dayStart || sessionDate >= dayStart;
      const matchesEnd = !dayEnd || sessionDate <= dayEnd;
      return matchesQuery && matchesType && matchesStart && matchesEnd;
    });
  }, [sessions, searchQuery, consultType, startDate, endDate, t]);
  const noFilteredResults = !loading && !empty && filteredSessions.length === 0;

  return (
    <div className="space-y-6">
      <div className="sticky top-3 z-40 rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-lg backdrop-blur-md">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs text-slate-500">{t("history.kicker")}</div>
            <h1 className="text-2xl font-bold mb-2">{t("consultHistory.title")}</h1>
            <p className="text-sm text-slate-600">
              {t("consultHistory.description")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <BackButton fallbackHref="/?expanded=1" labelId="report.backHome" alwaysFallback />
            <Link
              href="/summary"
              className="inline-flex rounded-md bg-emerald-600 px-4 py-2 text-sm text-white"
            >
              {t("consultHistory.new")}
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
            {t("history.count", { shown: filteredSessions.length, total: sessions.length })}
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
                  placeholder={t("consultHistory.searchPlaceholder")}
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
                <div className="text-xs font-medium text-slate-500">{t("consultHistory.type")}</div>
                <select
                  value={consultType}
                  onChange={(event) =>
                    setConsultType(event.target.value as ConsultHistoryItem["goal"] | "all")
                  }
                  className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
                >
                  <option value="all">{t("history.allTypes")}</option>
                  <option value="open_chat">{goalLabel("open_chat", t)}</option>
                  <option value="common_issues">{goalLabel("common_issues", t)}</option>
                  <option value="direction_judgement">{goalLabel("direction_judgement", t)}</option>
                  <option value="practice_plan">{goalLabel("practice_plan", t)}</option>
                  <option value="single_review">{goalLabel("single_review", t)}</option>
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
                  setConsultType("all");
                }}
                className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
              >
                {t("history.clear")}
              </button>
            </div>
          </>
        )}
      </div>

      {loading && <LoadingIndicator label={t("consultHistory.loading")} />}
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {empty && (
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="text-sm font-medium mb-2">{t("consultHistory.emptyTitle")}</div>
          <div className="text-sm text-slate-600 mb-4">
            {t("consultHistory.emptyDesc")}
          </div>
          <Link
            href="/summary"
            className="inline-flex rounded-md bg-slate-900 px-4 py-2 text-sm text-white"
          >
            {t("consultHistory.go")}
          </Link>
        </div>
      )}

      {noFilteredResults && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
          {t("consultHistory.noResults")}
        </div>
      )}

      {!empty && !noFilteredResults && (
        <div className="space-y-3">
          {filteredSessions.map((session) => (
            <div key={session.id} className="relative overflow-hidden rounded-xl border border-slate-200 bg-white p-5">
              {session.status === "completed" && (
                <div
                  className="pointer-events-none absolute -bottom-4 -right-3 flex h-24 w-24 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-700/20 ring-1 ring-emerald-600/10"
                  title={t("consultHistory.completed")}
                  aria-hidden="true"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-14 w-14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                </div>
              )}
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex rounded-md bg-emerald-50 px-2.5 py-1 text-sm font-medium text-emerald-700 ring-1 ring-emerald-200">
                      {goalLabel(session.goal, t)}
                    </span>
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs ${
                        session.status === "active"
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {session.status === "active" ? t("consultHistory.active") : t("consultHistory.completed")}
                    </span>
                    <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                      {session.summaryMode === "single_session" ? t("consultHistory.single") : t("consultHistory.multi")}
                    </span>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-2">
                    {session.selectedRecords.map((record) => (
                      <span
                        key={record.id}
                        className="inline-flex rounded-md bg-slate-50 px-2.5 py-1 text-sm text-slate-700 ring-1 ring-slate-200"
                      >
                        {record.jobTitle} · {record.company}
                      </span>
                    ))}
                  </div>

                  <div className="mt-2 text-xs text-slate-500">
                    {t("consultHistory.created", {
                      created: formatDateTime(session.createdAt, language),
                      updated: formatDateTime(session.updatedAt, language),
                      count: session.messageCount,
                    })}
                  </div>

                  {session.latestJudgement && (
                    <div className="mt-3 text-sm text-slate-700">
                      <span className="font-medium text-slate-900">{t("consultHistory.latestJudgement")}</span>
                      {session.latestJudgement}
                    </div>
                  )}

                  {session.lastMessagePreview && (
                    <div className="mt-2 text-sm text-slate-600">
                      <span className="font-medium text-slate-900">{t("consultHistory.latestChat")}</span>
                      {session.lastMessagePreview}
                    </div>
                  )}
                </div>

                <div className="relative z-10 flex flex-wrap items-start justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => viewConsult(session.id)}
                    disabled={continuingId === session.id}
                    className="inline-flex rounded-md border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 disabled:opacity-50"
                  >
                    {t("consultHistory.view")}
                  </button>
                  {session.status !== "completed" && (
                    <button
                      type="button"
                      onClick={() => continueConsult(session.id)}
                      disabled={continuingId === session.id}
                      className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm text-white disabled:opacity-50"
                    >
                      {continuingId === session.id ? (
                        <>
                          <LoadingDots />
                          {t("consultHistory.entering")}
                        </>
                      ) : (
                        t("consultHistory.continue")
                      )}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => deleteConsult(session.id)}
                    disabled={deletingId === session.id}
                    className="inline-flex rounded-md border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700 disabled:opacity-50"
                  >
                    {deletingId === session.id ? t("history.deleting") : t("history.delete")}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function goalLabel(
  value: ConsultHistoryItem["goal"],
  t: (key: string) => string
) {
  if (value === "direction_judgement") return t("summary.goal.direction");
  if (value === "practice_plan") return t("summary.goal.plan");
  if (value === "single_review") return t("summary.goal.single");
  if (value === "open_chat") return t("summary.goal.open");
  return t("summary.goal.common");
}

function formatDateTime(timestamp: number, language: "zh" | "en") {
  return new Date(timestamp).toLocaleString(language === "en" ? "en-US" : "zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
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
