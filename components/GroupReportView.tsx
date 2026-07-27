"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "./LanguageProvider";
import { CollaborationScoreMeter, DimensionScoreMeter } from "./ScoreMeter";
import {
  type GroupAnnotationStatus,
  type GroupMember,
  type GroupReport,
  type GroupTopic,
  type GroupTurn,
  type GroupTurnAnnotation,
  type GroupTurnReview,
  GROUP_REPORT_DIMENSIONS,
} from "@/lib/groupInterview/types";

type AnnotationLoadState = "idle" | "loading" | "running" | "ready" | "error";

type AnnotationStatusPayload = {
  report?: GroupReport;
  annotationStatus?: GroupAnnotationStatus;
  annotationError?: string;
};

export default function GroupReportView({
  sessionId,
  report: initialReport,
  topic,
  company,
  jobTitle,
  transcript,
  className = "",
}: {
  sessionId: string;
  report: GroupReport;
  topic: GroupTopic;
  company: string;
  jobTitle: string;
  members: GroupMember[];
  transcript: GroupTurn[];
  className?: string;
}) {
  const { t } = useI18n();
  const [report, setReport] = useState(initialReport);
  const [loadState, setLoadState] = useState<AnnotationLoadState>("idle");

  const personal = report.personal;
  const group = report.group;
  const overallBand = scoreToBand(personal.overallScore);
  const collaborationBand = scoreToBand(group.collaborationScore);
  const annotationStatus = resolveAnnotationStatus(report, transcript);
  const userTurnCount = useMemo(
    () => transcript.filter((turn) => turn.speakerId === "user" && turn.text.trim().length > 0).length,
    [transcript]
  );

  const applyPayload = useCallback((data: AnnotationStatusPayload) => {
    if (data.report) setReport(data.report);
    const status = data.annotationStatus ?? data.report?.annotationStatus ?? "pending";
    if (status === "ready") setLoadState("ready");
    else if (status === "failed") setLoadState("error");
    else if (status === "running") setLoadState("running");
    else setLoadState("loading");
  }, []);

  // 触发逐条批注生成
  useEffect(() => {
    if (userTurnCount === 0 || annotationStatus === "ready" || loadState !== "idle") return;
    let cancelled = false;
    setLoadState("loading");
    fetch(`/api/group/${encodeURIComponent(sessionId)}/report/annotations`, { method: "POST" })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "failed to generate annotations");
        if (!cancelled) applyPayload(data as AnnotationStatusPayload);
      })
      .catch(() => {
        if (!cancelled) setLoadState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [annotationStatus, applyPayload, loadState, sessionId, userTurnCount]);

  // 轮询，逐条把已生成的批注呈现出来
  useEffect(() => {
    if (annotationStatus === "ready") return;
    if (loadState !== "loading" && loadState !== "running") return;
    let cancelled = false;
    const encoded = encodeURIComponent(sessionId);
    async function poll() {
      try {
        const res = await fetch(`/api/group/${encoded}/report/annotations`, { method: "GET" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "failed to load annotation status");
        if (!cancelled) applyPayload(data as AnnotationStatusPayload);
      } catch {
        if (!cancelled && loadState !== "running") setLoadState("error");
      }
    }
    void poll();
    const timer = window.setInterval(poll, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [annotationStatus, applyPayload, loadState, sessionId]);

  return (
    <div className={`space-y-6 ${className}`}>
      <div id="report-top" className="scroll-mt-24">
        <div className="text-xs text-slate-500">
          {company} · {jobTitle} · {t("interviewChoice.group")}
        </div>
        <h1 className="text-2xl font-bold">{t("groupReport.title")}</h1>
        <p className="mt-2 text-sm text-slate-600">{topic.title}</p>
      </div>

      <div id="report-overview" className="grid scroll-mt-24 gap-6 md:grid-cols-[0.75fr_1.55fr]">
        <div className="bg-white border rounded-md p-6">
          <div className="text-sm text-slate-500 mb-1">{t("groupReport.overall")}</div>
          <div className="space-y-2">
            <div className="flex items-end gap-3">
              <div className="text-5xl font-bold">{formatBand(overallBand)}</div>
              <div className="pb-1 text-sm text-slate-500">/ 9.0</div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-slate-500">{t("report.grade")}</span>
              <span className={`rounded-full px-3 py-1 text-sm font-medium ${gradeStyleForBand(overallBand)}`}>
                {gradeForBand(overallBand)}
              </span>
              {personal.roleTag && (
                <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700">
                  {personal.roleTag}
                </span>
              )}
            </div>
            <div className="text-sm text-slate-600">{gradeAdviceForBand(overallBand, t)}</div>
          </div>
        </div>

        <div className="bg-white border rounded-md p-6">
          <div className="text-sm font-medium mb-3">{t("report.dimensionScores")}</div>
          <div className="space-y-2">
            {GROUP_REPORT_DIMENSIONS.map((dim) => {
              const d = personal.dimensions[dim];
              if (!d) return null;
              const score = scoreToBand(d.score);
              return (
                <div key={dim} className="flex items-center gap-3">
                  <div className="w-32 text-sm text-slate-600">{t(`groupReport.dim.${dim}`)}</div>
                  <DimensionScoreMeter value={score} label={t(`groupReport.dim.${dim}`)} />
                  <div className="w-12 text-right text-sm">{formatBand(score)}</div>
                </div>
              );
            })}
            {GROUP_REPORT_DIMENSIONS.every((dim) => !personal.dimensions[dim]) && (
              <div className="text-sm text-slate-400">—</div>
            )}
          </div>
        </div>
      </div>

      {GROUP_REPORT_DIMENSIONS.some((dim) => personal.dimensions[dim]) && (
        <details id="report-dimensions" className="scroll-mt-24 bg-white border rounded-md p-6">
          <summary className="text-sm font-medium cursor-pointer">{t("report.dimensionDetails")}</summary>
          <div className="mt-4 space-y-4">
            {GROUP_REPORT_DIMENSIONS.map((dim) => {
              const d = personal.dimensions[dim];
              if (!d) return null;
              const score = scoreToBand(d.score);
              return (
                <div key={dim} className="border-l-2 border-slate-300 pl-4 space-y-2">
                  <div className="flex items-center justify-between gap-4">
                    <div className="text-sm font-medium">{t(`groupReport.dim.${dim}`)}</div>
                    <div className="text-sm text-slate-600">{formatBand(score)} / 9.0</div>
                  </div>
                  {d.reason && <div className="text-sm text-slate-700">{d.reason}</div>}
                  {d.evidence?.length > 0 && (
                    <ul className="list-disc pl-5 space-y-1 text-sm text-slate-700">
                      {d.evidence.map((item, index) => (
                        <li key={index}>{item}</li>
                      ))}
                    </ul>
                  )}
                  {d.advice && (
                    <div className="text-sm text-indigo-700">{t("report.advicePrefix")}{d.advice}</div>
                  )}
                </div>
              );
            })}
          </div>
        </details>
      )}

      <div id="report-summary" className="scroll-mt-24 space-y-6">
        <Section title={t("groupReport.strengths")} items={personal.strengths} />
        <Section title={t("groupReport.weaknesses")} items={personal.weaknesses} />
        <Section title={t("groupReport.advice")} items={personal.advice} />
      </div>

      {personal.keyMoments.length > 0 && (
        <section className="bg-white border rounded-md p-6">
          <div className="text-sm font-medium mb-3">{t("groupReport.keyMoments")}</div>
          <div className="space-y-3">
            {personal.keyMoments.map((m, i) => (
              <div key={i} className="border-l-2 border-slate-200 pl-3">
                <div className="text-xs text-slate-500">#{m.turnIndex}</div>
                <div className="mt-1 text-sm text-slate-700">{m.comment}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="bg-white border rounded-md p-6">
        <div className="text-sm font-medium mb-3">{t("groupReport.groupView")}</div>
        {group.summary && <p className="text-sm leading-6 text-slate-700">{group.summary}</p>}
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <CompactList title={t("groupReport.consensus")} items={group.consensus} />
          <CompactList title={t("groupReport.disagreements")} items={group.disagreements} />
        </div>
        <div className="mt-4 border-t border-slate-100 pt-4">
          <div className="flex items-center gap-3 rounded-xl bg-blue-50/50 px-3 py-3 ring-1 ring-blue-100/80">
            <div className="w-28 text-sm text-slate-600">{t("groupReport.collaboration")}</div>
            <CollaborationScoreMeter
              value={collaborationBand}
              label={t("groupReport.collaboration")}
            />
            <div className="w-20 rounded-full bg-white px-2.5 py-1 text-right text-sm font-semibold text-blue-700 shadow-sm ring-1 ring-blue-100">
              {formatBand(collaborationBand)} / 9.0
            </div>
          </div>
          {group.reportQuality && (
            <p className="mt-3 text-sm text-slate-600">
              <span className="font-medium">{t("groupReport.reportQuality")}: </span>
              {group.reportQuality}
            </p>
          )}
        </div>
      </section>

      {report.leaderFeedback && (
        <section className="bg-white border rounded-md p-6">
          <div className="text-sm font-medium mb-2">{t("groupReport.leaderFeedback")}</div>
          <p className="whitespace-pre-line text-sm leading-6 text-slate-700">{report.leaderFeedback}</p>
        </section>
      )}

      <details id="report-records" className="scroll-mt-24 bg-white border rounded-md p-6" open>
        <summary className="text-sm font-medium cursor-pointer">
          {t("groupReport.transcript")}
        </summary>
        <AnnotationStatusNotice
          status={annotationStatus}
          loadState={loadState}
          progress={{ done: report.turnReviews?.length ?? 0, total: userTurnCount }}
        />
        <div className="mt-3 space-y-3">
          {transcript.map((turn) => {
            const isUser = turn.speakerId === "user";
            const review = isUser
              ? report.turnReviews?.find((r) => r.turnIndex === turn.index)
              : undefined;
            const annotations = isUser
              ? (report.turnAnnotations ?? []).filter((a) => a.turnIndex === turn.index)
              : [];

            if (!isUser) {
              return (
                <div key={turn.index} className="border-l-2 border-slate-200 pl-3">
                  <div className="text-xs text-slate-500">{turn.speakerName}</div>
                  <div className="mt-1 text-sm text-slate-700">{turn.text}</div>
                </div>
              );
            }

            return (
              <div key={turn.index} className="border-l-2 border-slate-300 pl-3">
                <div className="mb-1 text-xs font-medium text-slate-500">
                  {turn.speakerName} · {t("groupReport.yourTurn")}
                </div>
                <TurnReviewCard review={review} />
                <GroupAnnotatedText text={turn.text} annotations={annotations} />
              </div>
            );
          })}
        </div>
      </details>
    </div>
  );
}

function resolveAnnotationStatus(
  report: GroupReport,
  transcript: GroupTurn[]
): GroupAnnotationStatus {
  if (report.annotationStatus) return report.annotationStatus;
  const hasUserTurns = transcript.some((t) => t.speakerId === "user" && t.text.trim().length > 0);
  if (!hasUserTurns) return "ready";
  if ((report.turnReviews?.length ?? 0) > 0 || (report.turnAnnotations?.length ?? 0) > 0) {
    return "ready";
  }
  return "pending";
}

function AnnotationStatusNotice({
  status,
  loadState,
  progress,
}: {
  status: GroupAnnotationStatus;
  loadState: AnnotationLoadState;
  progress: { done: number; total: number };
}) {
  const { t } = useI18n();
  if (status === "ready" || loadState === "ready") return null;
  const failed = status === "failed" || loadState === "error";
  const showProgress = !failed && progress.total > 0 && progress.done > 0;
  return (
    <div
      className={`mt-3 flex items-center gap-2 rounded-md border px-3 py-2 text-xs ${
        failed
          ? "border-amber-200 bg-amber-50 text-amber-800"
          : "border-sky-200 bg-sky-50 text-sky-800"
      }`}
      aria-live="polite"
    >
      {!failed && <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-sky-500" />}
      <span>
        {failed
          ? t("groupReport.annotations.failed")
          : showProgress
          ? t("groupReport.annotations.progress", { done: progress.done, total: progress.total })
          : t("groupReport.annotations.pending")}
      </span>
    </div>
  );
}

function TurnReviewCard({ review }: { review?: GroupTurnReview }) {
  const { t } = useI18n();
  if (!review) return null;
  return (
    <div className="mb-2 space-y-1 rounded-md border border-slate-200 bg-white p-3">
      <div className="text-xs font-medium text-slate-500">{t("groupReport.turnReview")}</div>
      <div className="text-sm text-slate-700">{review.overallComment}</div>
      {review.mainStrength && (
        <div className="text-sm text-emerald-700">
          <span className="mr-2 inline-flex rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
            {t("report.overallStrength")}
          </span>
          {review.mainStrength}
        </div>
      )}
      {review.mainIssue && (
        <div className="text-sm text-rose-700">
          <span className="mr-2 inline-flex rounded bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700">
            {t("report.coreIssue")}
          </span>
          {review.mainIssue}
        </div>
      )}
      {review.nextStep && (
        <div className="text-sm text-indigo-700">
          <span className="mr-2 inline-flex rounded bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
            {t("report.nextAdvice")}
          </span>
          {review.nextStep}
        </div>
      )}
    </div>
  );
}

function GroupAnnotatedText({
  text,
  annotations,
}: {
  text: string;
  annotations: GroupTurnAnnotation[];
}) {
  const { t } = useI18n();
  const [activeId, setActiveId] = useState<string | null>(null);

  const inline = annotations
    .filter((a) => a.type !== "missing" && a.start >= 0 && a.end > a.start && a.end <= text.length)
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .reduce<GroupTurnAnnotation[]>((result, a) => {
      const prev = result[result.length - 1];
      if (prev && a.start < prev.end) return result;
      result.push(a);
      return result;
    }, []);
  const missing = annotations.filter((a) => a.type === "missing");

  let cursor = 0;
  return (
    <div className="space-y-2">
      <div className="text-sm leading-7 text-slate-700 whitespace-pre-wrap">
        {inline.map((a) => {
          const before = text.slice(cursor, a.start);
          const marked = text.slice(a.start, a.end);
          cursor = a.end;
          return (
            <span key={a.id}>
              {before}
              <span className="relative inline whitespace-normal align-baseline group">
                <span
                  role="button"
                  tabIndex={0}
                  onClick={() => setActiveId((c) => (c === a.id ? null : a.id))}
                  onBlur={() => setActiveId(null)}
                  className={`inline whitespace-pre-wrap break-words [overflow-wrap:anywhere] rounded px-0.5 underline decoration-2 underline-offset-4 ${styleForType(
                    a.type
                  )}`}
                >
                  {marked}
                </span>
                <span
                  className={`absolute bottom-full left-0 z-20 mb-2 w-72 rounded-md border bg-white p-3 text-left text-xs leading-5 text-slate-700 shadow-lg whitespace-normal ${
                    activeId === a.id ? "block" : "hidden group-hover:block group-focus-within:block"
                  }`}
                >
                  <span className="mb-1 block font-medium text-slate-900">{labelForType(a.type, t)}</span>
                  <span className="block">{a.comment}</span>
                  {a.suggestion && (
                    <span className="mt-1 block text-indigo-700">
                      {t("annotation.advice", { text: a.suggestion })}
                    </span>
                  )}
                  {a.dimensions.length > 0 && (
                    <span className="mt-2 block text-slate-500">
                      {t("annotation.dimensions", {
                        text: a.dimensions.map((d) => t(`groupReport.dim.${d}`)).join(" / "),
                      })}
                    </span>
                  )}
                </span>
              </span>
            </span>
          );
        })}
        {text.slice(cursor)}
      </div>
      {missing.map((a) => (
        <div key={a.id} className="rounded-md border bg-slate-50 p-3 text-sm">
          <div className="mb-1 text-xs font-medium text-slate-500">{t("annotation.missingInfo")}</div>
          <div className="text-slate-700">{a.comment}</div>
          {a.suggestion && (
            <div className="mt-1 text-indigo-700">{t("annotation.advice", { text: a.suggestion })}</div>
          )}
        </div>
      ))}
    </div>
  );
}

function styleForType(type: GroupTurnAnnotation["type"]): string {
  if (type === "strength") return "bg-emerald-50 decoration-emerald-500 hover:bg-emerald-100";
  if (type === "weakness") return "bg-rose-50 decoration-rose-500 hover:bg-rose-100";
  if (type === "suggestion") return "bg-sky-50 decoration-sky-500 hover:bg-sky-100";
  if (type === "clarity") return "bg-amber-50 decoration-amber-500 hover:bg-amber-100";
  return "bg-slate-50 decoration-slate-400 hover:bg-slate-100";
}

function labelForType(type: GroupTurnAnnotation["type"], t: (key: string) => string): string {
  if (type === "strength") return t("annotation.strength");
  if (type === "weakness") return t("annotation.weakness");
  if (type === "suggestion") return t("annotation.suggestion");
  if (type === "clarity") return t("annotation.clarity");
  return t("annotation.missingInfo");
}

function scoreToBand(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const normalized = value > 9 ? (value / 100) * 9 : value;
  return Math.round(Math.max(0, Math.min(9, normalized)) * 2) / 2;
}

function formatBand(value: number): string {
  if (!Number.isFinite(value)) return "0.0";
  return value.toFixed(1);
}

function gradeForBand(value: number): "A" | "B" | "C" | "D" | "E" | "F" {
  if (value >= 7) return "A";
  if (value >= 6) return "B";
  if (value >= 5) return "C";
  if (value >= 4) return "D";
  if (value >= 3) return "E";
  return "F";
}

function gradeStyleForBand(value: number): string {
  if (value >= 7) return "bg-emerald-600 text-white";
  if (value >= 6) return "bg-lime-500 text-white";
  if (value >= 5) return "bg-amber-400 text-slate-900";
  if (value >= 4) return "bg-orange-400 text-slate-900";
  if (value >= 3) return "bg-red-400 text-white";
  return "bg-rose-700 text-white";
}

function gradeAdviceForBand(value: number, t: (key: string) => string): string {
  if (value >= 7) return t("grade.advice.a");
  if (value >= 6) return t("grade.advice.b");
  if (value >= 5) return t("grade.advice.c");
  if (value >= 4) return t("grade.advice.d");
  if (value >= 3) return t("grade.advice.e");
  return t("grade.advice.f");
}

function Section({ title, items }: { title: string; items: string[] }) {
  if (!items?.length) return null;
  return (
    <div className="bg-white border rounded-md p-6">
      <div className="text-sm font-medium mb-2">{title}</div>
      <ul className="list-disc pl-5 space-y-1 text-sm text-slate-700">
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function CompactList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-md border border-slate-100 bg-slate-50 p-4">
      <div className="text-sm font-medium text-slate-800 mb-2">{title}</div>
      {items.length ? (
        <ul className="list-disc pl-5 space-y-1 text-sm text-slate-700">
          {items.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      ) : (
        <div className="text-sm text-slate-400">—</div>
      )}
    </div>
  );
}
