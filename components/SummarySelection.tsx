"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "./LanguageProvider";
import BackButton from "./BackButton";
import LoadingIndicator, { LoadingDots } from "./LoadingIndicator";
import { DEFAULT_MODEL_ID, MODEL_OPTIONS } from "@/lib/llm/models";

type HistoryItem = {
  id: string;
  sessionId: string;
  company: string;
  jobTitle: string;
  interviewType: "hr" | "technical" | "behavioral" | "mixed";
  reportedAt: number;
  overallBand: number;
  reportKind?: "score" | "mbti";
  mbtiType?: string;
  weaknesses: string[];
  roundCount: number;
  kind?: "one_on_one" | "group";
  topicTitle?: string;
};

type GroupHistoryItem = {
  id: string;
  company: string;
  jobTitle: string;
  topicTitle?: string;
  status: string;
  hasReport: boolean;
  overallScore: number | null;
  createdAt: number;
};

type ConsultHistoryItem = {
  id: string;
  status: "active" | "stopped" | "completed";
  updatedAt: number;
  latestJudgement: string | null;
  selectedRecords: Array<{
    id: string;
  }>;
};

type ConsultedRecordMeta = {
  count: number;
};

export default function SummarySelection({ preselect }: { preselect?: string }) {
  const router = useRouter();
  const { language, t } = useI18n();
  const [records, setRecords] = useState<HistoryItem[]>([]);
  const [consultedRecordMetaById, setConsultedRecordMetaById] = useState<Record<string, ConsultedRecordMeta>>({});
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [modelId, setModelId] = useState(DEFAULT_MODEL_ID);
  const [memoryEnabled, setMemoryEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [interviewType, setInterviewType] = useState<HistoryItem["interviewType"] | "all">("all");
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const timestamp = Date.now();
      const [historyResult, groupHistoryResult, consultHistoryResult] = await Promise.allSettled([
        fetch(`/api/history?t=${timestamp}`, { cache: "no-store" }),
        fetch(`/api/group/history?t=${timestamp}`, { cache: "no-store" }),
        fetch(`/api/consult/history?t=${timestamp}`, { cache: "no-store" }),
      ]);
      if (historyResult.status === "rejected") throw historyResult.reason;
      const res = historyResult.value;
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "加载历史记录失败");
      const oneOnOneRecords = ((json.records || []) as HistoryItem[]).map((item) => ({
        ...item,
        kind: "one_on_one" as const,
      }));

      let groupItems: HistoryItem[] = [];
      if (groupHistoryResult.status === "fulfilled" && groupHistoryResult.value.ok) {
        try {
          const groupJson = await groupHistoryResult.value.json();
          groupItems = ((groupJson.records || []) as GroupHistoryItem[])
            .filter((g) => g.hasReport)
            .map((g) => ({
              id: g.id,
              sessionId: g.id,
              company: g.company,
              jobTitle: g.jobTitle,
              interviewType: "behavioral" as const,
              reportedAt: g.createdAt,
              overallBand: g.overallScore ?? 0,
              weaknesses: [],
              roundCount: 0,
              kind: "group" as const,
              topicTitle: g.topicTitle,
            }));
        } catch {
          groupItems = [];
        }
      }

      const nextRecords = [...oneOnOneRecords, ...groupItems].sort(
        (a, b) => b.reportedAt - a.reportedAt
      );
      setRecords(nextRecords);
      if (consultHistoryResult.status === "fulfilled" && consultHistoryResult.value.ok) {
        const consultRes = consultHistoryResult.value;
        try {
          const consultJson = await consultRes.json();
          setConsultedRecordMetaById(buildConsultedRecordMetaMap((consultJson.sessions || []) as ConsultHistoryItem[]));
        } catch {
          setConsultedRecordMetaById({});
        }
      }
      if (preselect) {
        const matched = nextRecords.find(
          (item) => item.id === preselect || item.sessionId === preselect
        );
        setSelectedIds(matched ? [matched.id] : nextRecords.slice(0, 3).map((item) => item.id));
      } else {
        setSelectedIds(nextRecords.slice(0, 3).map((item) => item.id));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载历史记录失败");
    } finally {
      setLoading(false);
    }
  }

  const selectedCount = selectedIds.length;
  const empty = !loading && records.length === 0;

  const helperText = useMemo(() => {
    if (selectedCount <= 1) return t("summary.helper.single");
    return t("summary.helper.multi");
  }, [selectedCount, t]);
  const filteredRecords = useMemo(() => {
    return records.filter((record) => {
      const query = searchQuery.trim().toLowerCase();
      const recordDate = new Date(record.reportedAt);
      const dayStart = isValidDateInput(startDate) ? new Date(`${startDate}T00:00:00`) : null;
      const dayEnd = isValidDateInput(endDate) ? new Date(`${endDate}T23:59:59.999`) : null;
      const matchesQuery =
        !query ||
        [record.jobTitle, record.company, record.topicTitle ?? "", ...record.weaknesses]
          .join(" ")
          .toLowerCase()
          .includes(query);
      const matchesType =
        record.kind === "group" || interviewType === "all" || record.interviewType === interviewType;
      const matchesStart = !dayStart || recordDate >= dayStart;
      const matchesEnd = !dayEnd || recordDate <= dayEnd;
      return matchesQuery && matchesType && matchesStart && matchesEnd;
    });
  }, [records, searchQuery, interviewType, startDate, endDate]);

  function toggle(id: string) {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
  }

  async function startSummary() {
    // 选择是可选的：不选记录也可直接开聊（自由咨询）。
    setSubmitting(true);
    setError(null);
    try {
      const kindById = new Map(records.map((record) => [record.id, record.kind ?? "one_on_one"]));
      const selectedInterviewSessionIds = selectedIds.filter((id) => kindById.get(id) !== "group");
      const selectedGroupSessionIds = selectedIds.filter((id) => kindById.get(id) === "group");
      const res = await fetch("/api/consult/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selectedInterviewSessionIds,
          selectedGroupSessionIds,
          modelId,
          memoryEnabled,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "创建战略咨询会话失败");
      sessionStorage.setItem(`consult-new-entry:${json.consultId}`, "1");
      router.push(`/consult/${json.consultId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建战略咨询会话失败");
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="sticky top-3 z-40 rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-lg backdrop-blur-md">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs text-slate-500">{t("summary.kicker")}</div>
            <h1 className="text-2xl font-bold mb-2">{t("summary.title")}</h1>
            <p className="text-sm text-slate-600">
              {t("summary.description")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <BackButton fallbackHref="/?expanded=1" labelId="report.backHome" alwaysFallback />
          </div>
        </div>
      </div>

      {loading && <LoadingIndicator label={t("summary.loading")} />}
      {error && <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      {empty && (
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="text-sm font-medium mb-2">{t("summary.emptyTitle")}</div>
          <div className="text-sm text-slate-600 mb-4">
            {t("summary.emptyDesc")}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => router.push("/consult/start")}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-700"
            >
              {t("summary.startOpenChat")}
            </button>
            <button
              type="button"
              onClick={() => router.push("/interview/choose")}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              {t("summary.goInterview")}
            </button>
          </div>
        </div>
      )}

      {!empty && records.length > 0 && (
        <>
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
                        setInterviewType(event.target.value as HistoryItem["interviewType"] | "all")
                      }
                      className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
                    >
                      <option value="all">{t("history.allTypes")}</option>
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

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="max-h-[28rem] space-y-3 overflow-y-auto pr-2">
              {filteredRecords.map((record) => {
                const checked = selectedIds.includes(record.id);
                const consultedMeta = consultedRecordMetaById[record.id];
                return (
                  <label
                    key={record.id}
                    className={`block cursor-pointer rounded-xl border p-4 transition ${
                      checked
                        ? "border-emerald-400 bg-emerald-50 shadow-sm ring-2 ring-emerald-100"
                        : "border-slate-200 bg-white hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(record.id)}
                        className="mt-1"
                      />
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
                          {record.kind === "group" ? (
                            <span className="inline-flex rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700">
                              {t("interviewChoice.group")}
                            </span>
                          ) : (
                            <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                              {interviewTypeLabel(record.interviewType, t)}
                            </span>
                          )}
                          {consultedMeta && (
                            <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-amber-100">
                              {t("summary.consultedBadge", { count: consultedMeta.count })}
                            </span>
                          )}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {formatDate(record.reportedAt, language)}
                          {record.kind === "group"
                            ? ` · ${t("history.scoreMeta", {
                                score: record.overallBand.toFixed(1),
                                grade: gradeForBand(record.overallBand),
                              })}`
                            : record.reportKind === "mbti"
                              ? ` · MBTI ${record.mbtiType || t("history.mbtiPending")}`
                              : ` · ${t("history.scoreMeta", {
                                  score: record.overallBand.toFixed(1),
                                  grade: gradeForBand(record.overallBand),
                                })}`}
                          {record.kind !== "group" &&
                            ` · ${t("history.roundCount", { count: record.roundCount })}`}
                        </div>
                        {record.kind === "group" && record.topicTitle && (
                          <div className="mt-1 truncate text-sm text-slate-600">{record.topicTitle}</div>
                        )}
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
                    </div>
                  </label>
                );
              })}
              {filteredRecords.length === 0 && (
                <div className="rounded-lg bg-slate-50 p-6 text-sm text-slate-600">
                  {t("history.noResults")}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">{t("summary.aiModel")}</label>
              <select
                value={modelId}
                onChange={(event) => setModelId(event.target.value)}
                className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
              >
                {MODEL_OPTIONS.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                    {model.note ? ` — ${t(`model.${model.id}.note`)}` : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-medium text-slate-900">{t("summary.memory")}</div>
                  <div className="mt-1 text-xs leading-5 text-slate-600">
                    {memoryEnabled ? t("summary.memoryOnDesc") : t("summary.memoryOffDesc")}
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={memoryEnabled}
                  onClick={() => setMemoryEnabled((current) => !current)}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${
                    memoryEnabled ? "bg-emerald-600" : "bg-slate-300"
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${
                      memoryEnabled ? "translate-x-5" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>
            </div>

            <div className="text-sm text-slate-600">
              {t("summary.selected", { count: selectedCount, helper: helperText })}
            </div>

            <button
              type="button"
              disabled={submitting}
              onClick={startSummary}
              className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <LoadingDots />
                  {t("summary.entering")}
                </>
              ) : selectedIds.length ? (
                t("summary.start")
              ) : (
                t("summary.startOpenChat")
              )}
            </button>
            <p className="text-xs text-slate-500">{t("summary.optionalHint")}</p>
          </div>
        </>
      )}
    </div>
  );
}

function formatDate(timestamp: number, language: "zh" | "en") {
  return new Date(timestamp).toLocaleDateString(language === "en" ? "en-US" : "zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
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
  value: HistoryItem["interviewType"],
  t: (key: string) => string
) {
  return t(`type.${value}`);
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

function buildConsultedRecordMetaMap(sessions: ConsultHistoryItem[]): Record<string, ConsultedRecordMeta> {
  const result: Record<string, ConsultedRecordMeta> = {};
  for (const session of sessions) {
    if (session.status !== "completed") continue;
    for (const record of session.selectedRecords) {
      if (!record.id) continue;
      const current = result[record.id];
      result[record.id] = {
        count: (current?.count || 0) + 1,
      };
    }
  }
  return result;
}
