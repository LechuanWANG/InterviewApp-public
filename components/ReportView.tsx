"use client";

import { useCallback, useEffect, useState } from "react";
import {
  REPORT_DIMENSIONS,
  type MbtiAxisDetail,
  type Report,
  type ReportAnnotationStatus,
  type ReportDimension,
  type ReportDimensionDetail,
  type Round,
} from "@/lib/types";
import AnnotatedAnswer from "./AnnotatedAnswer";
import { useI18n } from "./LanguageProvider";
import { DimensionScoreMeter } from "./ScoreMeter";

type AnnotationLoadState = "idle" | "loading" | "running" | "ready" | "error";

type AnnotationStatusPayload = {
  report?: Report;
  annotationStatus?: ReportAnnotationStatus;
  annotationStartedAt?: number;
  annotationFinishedAt?: number;
  annotationElapsedMs?: number;
  annotationError?: string;
};

export default function ReportView({
  report: initialReport,
  rounds,
  company,
  jobTitle,
  sessionId,
  className = "",
}: {
  report: Report;
  rounds: Round[];
  company: string;
  jobTitle: string;
  sessionId?: string;
  className?: string;
}) {
  const { t } = useI18n();
  const [report, setReport] = useState(initialReport);
  const [annotationLoadState, setAnnotationLoadState] = useState<AnnotationLoadState>("idle");
  const [annotationInfo, setAnnotationInfo] = useState<AnnotationStatusPayload>(() =>
    annotationPayloadFromReport(initialReport)
  );
  const annotationStatus = resolveAnnotationStatus(report, rounds);
  const overallBand = scoreToBand(report.overallBand ?? report.overallScore ?? 0);
  const dimensionScores = resolveDisplayDimensionScores(report);
  const dimensionDetails = resolveDisplayDimensionDetails(report, dimensionScores);

  useEffect(() => {
    setReport(initialReport);
    setAnnotationLoadState("idle");
    setAnnotationInfo(annotationPayloadFromReport(initialReport));
  }, [initialReport]);

  const applyAnnotationPayload = useCallback((data: AnnotationStatusPayload) => {
    setAnnotationInfo(data);
    if (data.report) setReport(data.report);
    const status = data.annotationStatus ?? data.report?.annotationStatus ?? "pending";
    if (status === "ready") {
      setAnnotationLoadState("ready");
    } else if (status === "failed") {
      setAnnotationLoadState("error");
    } else if (status === "running") {
      setAnnotationLoadState("running");
    } else {
      setAnnotationLoadState("loading");
    }
  }, []);

  useEffect(() => {
    if (
      !sessionId ||
      rounds.length === 0 ||
      annotationStatus === "ready" ||
      annotationLoadState !== "idle"
    ) {
      return;
    }

    let cancelled = false;
    setAnnotationLoadState("loading");

    fetch(`/api/session/${encodeURIComponent(sessionId)}/report/annotations`, { method: "POST" })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "failed to generate annotations");
        if (cancelled) return;
        applyAnnotationPayload(data as AnnotationStatusPayload);
      })
      .catch(() => {
        if (!cancelled) setAnnotationLoadState("error");
      });

    return () => {
      cancelled = true;
    };
  }, [annotationLoadState, annotationStatus, applyAnnotationPayload, rounds.length, sessionId]);

  useEffect(() => {
    if (!sessionId || annotationStatus === "ready") return;
    if (annotationLoadState !== "loading" && annotationLoadState !== "running") return;

    let cancelled = false;
    const encodedSessionId = encodeURIComponent(sessionId);
    async function poll() {
      try {
        const res = await fetch(
          `/api/session/${encodedSessionId}/report/annotations`,
          { method: "GET" }
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "failed to load annotation status");
        if (!cancelled) applyAnnotationPayload(data as AnnotationStatusPayload);
      } catch {
        if (!cancelled && annotationLoadState !== "running") {
          setAnnotationLoadState("error");
        }
      }
    }

    void poll();
    const timer = window.setInterval(poll, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [annotationLoadState, annotationStatus, applyAnnotationPayload, sessionId]);

  if (report.reportKind === "mbti" && report.mbtiReport) {
    return (
      <BehavioralMbtiReportView
        report={report}
        rounds={rounds}
        company={company}
        jobTitle={jobTitle}
        annotationStatus={annotationStatus}
        annotationLoadState={annotationLoadState}
        className={className}
      />
    );
  }

  return (
    <div className={`space-y-6 ${className}`}>
      <div id="report-top" className="scroll-mt-24">
        <div className="text-xs text-slate-500">
          {company} · {jobTitle}
        </div>
        <h1 className="text-2xl font-bold">{t("report.title")}</h1>
      </div>

      <div id="report-overview" className="grid scroll-mt-24 gap-6 md:grid-cols-[0.75fr_1.55fr]">
        <div className="bg-white border rounded-md p-6">
          <div className="text-sm text-slate-500 mb-1">{t("report.overallScore")}</div>
          <div className="space-y-2">
            <div className="flex items-end gap-3">
              <div className="text-5xl font-bold">{formatBand(overallBand)}</div>
              <div className="pb-1 text-sm text-slate-500">/ 9.0</div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-500">{t("report.grade")}</span>
              <span
                className={`rounded-full px-3 py-1 text-sm font-medium ${gradeStyleForBand(
                  overallBand
                )}`}
              >
                {gradeForBand(overallBand)}
              </span>
            </div>
            <div className="text-sm text-slate-600">{gradeAdviceForBand(overallBand, t)}</div>
          </div>
        </div>

        <div className="bg-white border rounded-md p-6">
          <div className="text-sm font-medium mb-3">{t("report.dimensionScores")}</div>
          <div className="space-y-2">
            {REPORT_DIMENSIONS.map(
              (dimension) => {
                const value = dimensionScores[dimension];
                if (typeof value !== "number") return null;
                return (
                  <div key={dimension} className="flex items-center gap-3">
                    <div className="w-36 text-sm text-slate-600">{t(`dimension.${dimension}`)}</div>
                    <DimensionScoreMeter value={value} label={t(`dimension.${dimension}`)} />
                    <div className="w-12 text-right text-sm">{formatBand(value)}</div>
                  </div>
                );
              }
            )}
          </div>
        </div>
      </div>

      {Object.keys(dimensionDetails).length > 0 && (
        <details id="report-dimensions" className="scroll-mt-24 bg-white border rounded-md p-6">
          <summary className="text-sm font-medium cursor-pointer">{t("report.dimensionDetails")}</summary>
          <div className="mt-4 space-y-4">
            {REPORT_DIMENSIONS.map((dimension) => {
              const detail = dimensionDetails[dimension];
              if (!detail) return null;
              return (
                <div key={dimension} className="border-l-2 border-slate-300 pl-4 space-y-2">
                  <div className="flex items-center justify-between gap-4">
                    <div className="text-sm font-medium">{t(`dimension.${dimension}`)}</div>
                    <div className="text-sm text-slate-600">{formatBand(detail.score)} / 9.0</div>
                  </div>
                  <div className="text-sm text-slate-700">{detail.reason}</div>
                  {detail.evidence?.length > 0 && (
                    <ul className="list-disc pl-5 space-y-1 text-sm text-slate-700">
                      {detail.evidence.map((item, index) => (
                        <li key={index}>{item}</li>
                      ))}
                    </ul>
                  )}
                  <div className="text-sm text-indigo-700">{t("report.advicePrefix")}{detail.advice}</div>
                </div>
              );
            })}
          </div>
        </details>
      )}

      {report.penalties?.length > 0 && (
        <div className="bg-white border rounded-md p-6">
          <div className="text-sm font-medium mb-3">{t("report.penalties")}</div>
          <ul className="list-disc pl-5 space-y-1 text-sm">
            {report.penalties.map((item, index) => (
              <li key={index}>
                {item.reason}（-{item.points.toFixed(2)}）
              </li>
            ))}
          </ul>
        </div>
      )}

      <div id="report-summary" className="scroll-mt-24 space-y-6">
        <Section title={t("report.strengths")} items={report.strengths} />
        <Section title={t("report.weaknesses")} items={report.weaknesses} />
        <Section title={t("report.improvementAdvice")} items={report.improvementAdvice} />
      </div>

      <details id="report-records" className="scroll-mt-24 bg-white border rounded-md p-6" open>
        <summary className="text-sm font-medium cursor-pointer">
          {t("report.records", { count: rounds.length })}
        </summary>
        <AnnotationStatusNotice
          status={annotationStatus}
          loadState={annotationLoadState}
          progress={{ done: report.roundReviews?.length ?? 0, total: rounds.length }}
        />
        <div className="mt-3 space-y-3">
          {rounds.map((r, i) => (
            <div key={i} className="border-l-2 border-slate-200 pl-3">
              <div className="text-xs text-slate-500">
                {t("interview.round", { index: i + 1 })}{r.isFollowUp ? ` · ${t("report.followUp")}` : ""}
                {r.timedOut ? ` · ${t("report.timedOut")}` : ""}
              </div>
              <div className="text-sm font-medium mt-1">Q: {r.question}</div>
              <div className="mt-1">
                <div className="mb-1 text-sm font-medium text-slate-600">A:</div>
                <RoundReviewCard review={report.roundReviews?.find((review) => review.roundIndex === i + 1)} />
                <AnnotationSummary
                  summary={report.annotationSummaries?.find(
                    (summary) => summary.roundIndex === i + 1
                  )}
                />
                <AnnotatedAnswer
                  answer={r.answer}
                  annotations={(report.answerAnnotations ?? []).filter(
                    (annotation) => annotation.roundIndex === i + 1
                  )}
                />
              </div>
            </div>
          ))}
        </div>
      </details>

      {report.betterAnswers?.length > 0 && (
        <details id="report-answers" className="scroll-mt-24 bg-white border rounded-md p-6">
          <summary className="text-sm font-medium cursor-pointer">{t("report.betterAnswers")}</summary>
          <div className="mt-3 space-y-4">
            {report.betterAnswers.map((b, i) => (
              <div key={i} className="border-l-2 border-slate-300 pl-3">
                <div className="text-xs text-slate-500 mb-1">Q</div>
                <div className="text-sm mb-2">{b.question}</div>
                <div className="text-xs text-slate-500 mb-1">{t("report.suggestedAnswer")}</div>
                <div className="text-sm whitespace-pre-wrap">{b.suggested}</div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function BehavioralMbtiReportView({
  report,
  rounds,
  company,
  jobTitle,
  annotationStatus,
  annotationLoadState,
  className = "",
}: {
  report: Report;
  rounds: Round[];
  company: string;
  jobTitle: string;
  annotationStatus: ReportAnnotationStatus;
  annotationLoadState: AnnotationLoadState;
  className?: string;
}) {
  const { t } = useI18n();
  const mbti = report.mbtiReport;
  if (!mbti) return null;
  const axes = ["EI", "SN", "TF", "JP"].map((axis) => mbti.axes[axis as keyof typeof mbti.axes]);

  return (
    <div className={`space-y-6 ${className}`}>
      <div id="report-top" className="scroll-mt-24">
        <div className="text-xs text-slate-500">
          {company} · {jobTitle}
        </div>
        <h1 className="text-2xl font-bold">{t("report.mbtiTitle")}</h1>
      </div>

      <div id="report-overview" className="grid scroll-mt-24 gap-6 md:grid-cols-[0.75fr_1.55fr]">
        <div className="bg-white border rounded-md p-6">
          <div className="text-sm text-slate-500 mb-1">{t("report.mbtiResult")}</div>
          <div className="text-5xl font-bold tracking-wide">{mbti.mbtiType}</div>
          <div className="mt-3 text-sm text-slate-600 leading-6">{mbti.summary}</div>
          <div className="mt-3 text-xs text-slate-400">
            {t("report.mbtiDisclaimer")}
          </div>
        </div>

        <div className="bg-white border rounded-md p-6">
          <div className="text-sm font-medium mb-3">{t("report.mbtiAxes")}</div>
          <div className="space-y-4">
            {axes.map((axis) => (
              <MbtiAxisRow key={axis.axis} axis={axis} />
            ))}
          </div>
        </div>
      </div>

      <div id="report-summary" className="scroll-mt-24 space-y-6">
        <FoldableSection title={t("report.mbtiStrengths")} items={mbti.strengths} />
        <FoldableSection title={t("report.mbtiRisks")} items={mbti.risks} />
        <FoldableSection title={t("report.mbtiJobMatches")} items={mbti.jobMatches} />
      </div>

      <details id="report-records" className="scroll-mt-24 bg-white border rounded-md p-6" open>
        <summary className="text-sm font-medium cursor-pointer">
          {t("report.records", { count: rounds.length })}
        </summary>
        <AnnotationStatusNotice
          status={annotationStatus}
          loadState={annotationLoadState}
          mbtiMode
          progress={{ done: report.roundReviews?.length ?? 0, total: rounds.length }}
        />
        <div className="mt-3 space-y-3">
          {rounds.map((round, index) => (
            <div key={index} className="border-l-2 border-slate-200 pl-3">
              <div className="text-xs text-slate-500">
                {t("interview.round", { index: index + 1 })}{round.isFollowUp ? ` · ${t("report.followUp")}` : ""}
                {round.timedOut ? ` · ${t("report.timedOut")}` : ""}
              </div>
              <div className="text-sm font-medium mt-1">Q: {round.question}</div>
              <div className="mt-1">
                <div className="mb-1 text-sm font-medium text-slate-600">A:</div>
                <RoundReviewCard
                  review={report.roundReviews?.find((review) => review.roundIndex === index + 1)}
                  mbtiMode
                />
                <AnnotationSummary
                  summary={report.annotationSummaries?.find(
                    (summary) => summary.roundIndex === index + 1
                  )}
                  mbtiMode
                />
                <AnnotatedAnswer
                  answer={round.answer}
                  annotations={(report.answerAnnotations ?? []).filter(
                    (annotation) => annotation.roundIndex === index + 1
                  )}
                />
              </div>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

function MbtiAxisRow({ axis }: { axis: MbtiAxisDetail }) {
  const selectedOnLeft = axis.selected === axis.left;
  const colors = mbtiSideColors();
  const selectedShare = Math.max(0, Math.min(100, axis.tendency));
  const leftShare = selectedOnLeft ? selectedShare : 100 - selectedShare;
  const rightShare = selectedOnLeft ? 100 - selectedShare : selectedShare;
  const selectedLetterClass = selectedOnLeft
    ? "border-orange-500 bg-orange-50 text-orange-700"
    : "border-blue-500 bg-blue-50 text-blue-700";

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex h-6 w-6 items-center justify-center rounded-md border text-xs ${
            selectedOnLeft
              ? `font-bold ${selectedLetterClass}`
              : `border-transparent font-medium ${colors.leftText}`
          }`}
        >
          {axis.left}
        </span>
        <div className="flex h-2 flex-1 overflow-hidden rounded">
          <div className={colors.leftTrack} style={{ width: `${leftShare}%` }} />
          <div className={colors.rightTrack} style={{ width: `${rightShare}%` }} />
        </div>
        <span
          className={`inline-flex h-6 w-6 items-center justify-center rounded-md border text-xs ${
            !selectedOnLeft
              ? `font-bold ${selectedLetterClass}`
              : `border-transparent font-medium ${colors.rightText}`
          }`}
        >
          {axis.right}
        </span>
      </div>
      <ul className="list-disc pl-5 space-y-1 text-sm text-slate-700">
        <li>{axis.reason}</li>
        {axis.evidence.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function mbtiSideColors() {
  return {
    leftText: "text-orange-700",
    rightText: "text-blue-700",
    leftTrack: "bg-orange-400",
    rightTrack: "bg-blue-400",
  };
}

function AnnotationStatusNotice({
  status,
  loadState,
  mbtiMode = false,
  progress,
}: {
  status: ReportAnnotationStatus;
  loadState: AnnotationLoadState;
  mbtiMode?: boolean;
  progress?: { done: number; total: number };
}) {
  const { t } = useI18n();
  if (status === "ready" || loadState === "ready") return null;

  const failed = status === "failed" || loadState === "error";
  const showProgress = !failed && !!progress && progress.total > 0 && progress.done > 0;
  return (
    <div
      className={`mt-3 flex items-center gap-2 rounded-md border px-3 py-2 text-xs ${
        failed
          ? "border-amber-200 bg-amber-50 text-amber-800"
          : "border-sky-200 bg-sky-50 text-sky-800"
      }`}
      aria-live="polite"
    >
      {!failed && (
        <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-sky-500" />
      )}
      <span>
        {failed
          ? t("report.annotations.failed")
          : showProgress
          ? t("report.annotations.progress", { done: progress!.done, total: progress!.total })
          : t(mbtiMode ? "report.annotations.mbtiPending" : "report.annotations.pending")}
      </span>
    </div>
  );
}

function AnnotationSummary({
  summary,
  mbtiMode = false,
}: {
  summary?: { strengths: number; weaknesses: number; suggestions: number; mbtiEvidence?: number };
  mbtiMode?: boolean;
}) {
  const { t } = useI18n();
  if (
    !summary ||
    (!summary.strengths && !summary.weaknesses && !summary.suggestions && !summary.mbtiEvidence)
  ) {
    return null;
  }

  return (
    <div className="mb-2 flex flex-wrap gap-2 text-xs">
      {mbtiMode && (summary.mbtiEvidence ?? 0) > 0 && (
        <span className="rounded-full bg-violet-50 px-2 py-0.5 text-violet-700">
          {t("report.mbtiEvidence", { count: summary.mbtiEvidence ?? 0 })}
        </span>
      )}
      {!mbtiMode && (
        <>
      {summary.strengths > 0 && (
        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">
          {t("report.annotationStrength", { count: summary.strengths })}
        </span>
      )}
      {summary.weaknesses > 0 && (
        <span className="rounded-full bg-rose-50 px-2 py-0.5 text-rose-700">
          {t("report.annotationWeakness", { count: summary.weaknesses })}
        </span>
      )}
      {summary.suggestions > 0 && (
        <span className="rounded-full bg-sky-50 px-2 py-0.5 text-sky-700">
          {t("report.annotationSuggestion", { count: summary.suggestions })}
        </span>
      )}
        </>
      )}
    </div>
  );
}

function resolveDisplayDimensionScores(report: Report): Partial<Record<ReportDimension, number>> {
  const scoreSource = asLooseRecord(report.dimensionScores ?? report.categoryScores);
  const detailSource = asLooseRecord(report.dimensionDetails);
  const scores: Partial<Record<ReportDimension, number>> = {};
  for (const dimension of REPORT_DIMENSIONS) {
    const value = resolveDimensionNumber(dimension, scoreSource, detailSource);
    if (typeof value === "number") scores[dimension] = value;
  }
  return scores;
}

function resolveDisplayDimensionDetails(
  report: Report,
  scores: Partial<Record<ReportDimension, number>>
): Partial<Record<ReportDimension, ReportDimensionDetail>> {
  const detailSource = asLooseRecord(report.dimensionDetails);
  const details: Partial<Record<ReportDimension, ReportDimensionDetail>> = {};
  for (const dimension of REPORT_DIMENSIONS) {
    const detail = resolveDimensionDetail(dimension, detailSource);
    if (detail) {
      details[dimension] = {
        ...detail,
        score: scores[dimension] ?? detail.score,
      };
    }
  }
  return details;
}

function resolveDimensionNumber(
  dimension: ReportDimension,
  scoreSource: Record<string, unknown>,
  detailSource: Record<string, unknown>
): number | undefined {
  const direct = toFiniteNumber(
    scoreSource[dimension] ?? asLooseRecord(detailSource[dimension]).score
  );
  if (direct !== undefined) return scoreToBand(direct);
  const legacyValues = legacyDimensionAliases(dimension)
    .map((legacyDimension) =>
      toFiniteNumber(scoreSource[legacyDimension] ?? asLooseRecord(detailSource[legacyDimension]).score)
    )
    .filter((value): value is number => value !== undefined);
  if (!legacyValues.length) return undefined;
  return scoreToBand(legacyValues.reduce((sum, value) => sum + value, 0) / legacyValues.length);
}

function resolveDimensionDetail(
  dimension: ReportDimension,
  detailSource: Record<string, unknown>
): ReportDimensionDetail | undefined {
  const direct = toReportDimensionDetail(detailSource[dimension]);
  if (direct) return direct;
  for (const legacyDimension of legacyDimensionAliases(dimension)) {
    const legacy = toReportDimensionDetail(detailSource[legacyDimension]);
    if (legacy) return legacy;
  }
  return undefined;
}

function legacyDimensionAliases(dimension: ReportDimension): string[] {
  if (dimension === "岗位匹配度") return ["岗位匹配度"];
  if (dimension === "回答完整度") return ["回答完整度"];
  if (dimension === "逻辑表达清晰度") return ["逻辑性", "沟通表达"];
  if (dimension === "业务理解与价值表达") return ["专业度"];
  if (dimension === "关键能力可信度") return ["专业度", "岗位匹配度"];
  return [];
}

function toReportDimensionDetail(value: unknown): ReportDimensionDetail | undefined {
  const source = asLooseRecord(value);
  const score = toFiniteNumber(source.score);
  if (score === undefined) return undefined;
  return {
    score: scoreToBand(score),
    evidence: Array.isArray(source.evidence)
      ? source.evidence.filter((item): item is string => typeof item === "string")
      : [],
    reason: typeof source.reason === "string" ? source.reason : "",
    advice: typeof source.advice === "string" ? source.advice : "",
  };
}

function asLooseRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toFiniteNumber(value: unknown): number | undefined {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(numeric) ? numeric : undefined;
}

function scoreToBand(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const normalized = value > 9 ? (value / 100) * 9 : value;
  return Math.round(Math.max(0, Math.min(9, normalized)) * 2) / 2;
}

function resolveAnnotationStatus(report: Report, rounds: Round[]): ReportAnnotationStatus {
  if (report.annotationStatus) return report.annotationStatus;
  if (rounds.length === 0) return "ready";
  if (
    (report.roundReviews?.length ?? 0) > 0 ||
    (report.answerAnnotations?.length ?? 0) > 0 ||
    (report.annotationSummaries?.length ?? 0) > 0
  ) {
    return "ready";
  }
  return "pending";
}

function annotationPayloadFromReport(report: Report): AnnotationStatusPayload {
  return {
    report,
    annotationStatus: report.annotationStatus ?? "pending",
    annotationStartedAt: report.annotationStartedAt,
    annotationFinishedAt: report.annotationFinishedAt,
    annotationError: report.annotationError,
  };
}

function RoundReviewCard({
  review,
  mbtiMode = false,
}: {
  review?: {
    overallComment: string;
    mainStrength?: string;
    mainIssue?: string;
    nextStep?: string;
  };
  mbtiMode?: boolean;
}) {
  const { t } = useI18n();
  if (!review) return null;
  const visibleMainStrength = shouldRenderReviewText(review.mainStrength, "strength", mbtiMode)
    ? review.mainStrength
    : undefined;
  const visibleMainIssue = shouldRenderReviewText(review.mainIssue, "issue", mbtiMode)
    ? review.mainIssue
    : undefined;
  const visibleNextStep = shouldRenderReviewText(review.nextStep, "nextStep", mbtiMode)
    ? review.nextStep
    : undefined;

  return (
    <div className="mb-3 rounded-md border border-slate-200 bg-slate-50 p-3 space-y-2">
      <div className="text-xs font-medium text-slate-500">{t("report.roundReview")}</div>
      <div className="text-sm text-slate-700">{review.overallComment}</div>
      {visibleMainStrength && (
        <div className="text-sm text-emerald-700">
          <span className="mr-2 inline-flex rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
            {mbtiMode ? t("report.tendencyStrength") : t("report.overallStrength")}
          </span>
          {visibleMainStrength}
        </div>
      )}
      {visibleMainIssue && (
        <div className="text-sm text-rose-700">
          <span className="mr-2 inline-flex rounded-md bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700">
            {mbtiMode ? t("report.evidenceRisk") : t("report.coreIssue")}
          </span>
          {visibleMainIssue}
        </div>
      )}
      {!mbtiMode && visibleNextStep && (
        <div className="text-sm text-indigo-700">
          <span className="mr-2 inline-flex rounded-md bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
            {t("report.nextAdvice")}
          </span>
          {visibleNextStep}
        </div>
      )}
    </div>
  );
}

function shouldRenderReviewText(
  value: string | undefined,
  field: "strength" | "issue" | "nextStep",
  mbtiMode: boolean
): boolean {
  if (!value?.trim()) return false;
  const normalized = value.replace(/\s+/g, "");

  if (mbtiMode && field === "issue") {
    const hiddenPatterns = [
      "未发现明显证据不足或倾向风险",
      "暂无明显证据不足或倾向风险",
      "没有明显证据不足或倾向风险",
      "未见明显证据不足或倾向风险",
      "暂无明显风险",
      "未发现明显风险",
    ];
    if (hiddenPatterns.some((pattern) => normalized.includes(pattern))) {
      return false;
    }
  }

  return true;
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
      <ul className="list-disc pl-5 space-y-1 text-sm">
        {items.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>
    </div>
  );
}

function FoldableSection({ title, items }: { title: string; items: string[] }) {
  if (!items?.length) return null;
  return (
    <details className="bg-white border rounded-md p-6">
      <summary className="text-sm font-medium cursor-pointer">{title}</summary>
      <ul className="mt-3 list-disc pl-5 space-y-1 text-sm">
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </details>
  );
}
