import { saveInterviewRecord } from "../historyStore";
import { annotateRound } from "../prompts/annotateAnswers";
import { summarizeAnnotations } from "../prompts/annotateAnswersCore";
import { generateReport } from "../prompts/finalReport";
import { updateSession } from "../store";
import type { AnswerAnnotation, Report, RoundReview, Session } from "../types";

const ANNOTATION_RUNNING_STALE_MS = 4 * 60 * 1000;
// 逐轮批注的最大并发：每轮单独一次 LLM 调用，完成一轮就增量落库一轮。
const ROUND_ANNOTATION_CONCURRENCY = 4;

export async function ensureSessionReport(session: Session): Promise<Session> {
  if (session.report) {
    await saveInterviewRecord(session);
    return session;
  }

  if (session.rounds.length === 0) {
    throw new Error("no rounds to score");
  }

  const report = withAnnotationStatus(await generateReport(session), "pending");
  return persistReport(session, report);
}

export async function ensureSessionReportAnnotations(session: Session): Promise<Session> {
  const reportSession = session.report ? session : await ensureSessionReport(session);
  if (!reportSession.report) {
    throw new Error("report not generated");
  }

  if (reportSession.report.annotationStatus === "ready") {
    await saveInterviewRecord(reportSession);
    return reportSession;
  }

  if (
    reportSession.report.annotationStatus === "running" &&
    !isStaleRunningAnnotation(reportSession.report)
  ) {
    return reportSession;
  }

  const baseReport = reportSession.report;
  const rounds = reportSession.rounds;
  const startedAt = Date.now();

  // 进入 running，并清空上一次(可能失败)的批注，避免逐轮叠加重复。
  const runningReport: Report = {
    ...baseReport,
    roundReviews: [],
    answerAnnotations: [],
    annotationSummaries: [],
    annotationStatus: "running",
    annotationStartedAt: startedAt,
    annotationFinishedAt: undefined,
    annotationError: undefined,
  };
  await updateSession(
    reportSession.id,
    { report: runningReport, status: "finished" },
    reportSession.ownerId
  );

  if (rounds.length === 0) {
    return persistReport(reportSession, {
      ...runningReport,
      annotationStatus: "ready",
      annotationFinishedAt: Date.now(),
    });
  }

  const accReviews: RoundReview[] = [];
  const accAnnotations: AnswerAnnotation[] = [];
  let failures = 0;

  const buildSnapshot = (status: NonNullable<Report["annotationStatus"]>): Report => ({
    ...baseReport,
    roundReviews: [...accReviews].sort((a, b) => a.roundIndex - b.roundIndex),
    answerAnnotations: [...accAnnotations],
    annotationSummaries: summarizeAnnotations(accAnnotations, rounds.length),
    annotationStatus: status,
    annotationStartedAt: startedAt,
    annotationFinishedAt: status === "running" ? undefined : Date.now(),
    annotationError: undefined,
  });

  // 每轮单独一次 LLM 调用；完成一轮就增量落库一轮，让报告页轮询逐轮呈现。
  const runRound = async (roundIndex: number) => {
    try {
      const result = await annotateRound(reportSession, baseReport, roundIndex);
      accReviews.push(...result.roundReviews);
      accAnnotations.push(...result.answerAnnotations);
    } catch (error) {
      failures += 1;
      console.warn(`round ${roundIndex} annotation failed`, error);
    }
    try {
      await updateSession(
        reportSession.id,
        { report: buildSnapshot("running"), status: "finished" },
        reportSession.ownerId
      );
    } catch (persistError) {
      console.warn(`round ${roundIndex} incremental persist failed`, persistError);
    }
  };

  await runWithConcurrency(
    rounds.map((_, index) => index + 1),
    ROUND_ANNOTATION_CONCURRENCY,
    runRound
  );

  const allFailed = failures >= rounds.length;
  return persistReport(reportSession, {
    ...buildSnapshot(allFailed ? "failed" : "ready"),
    annotationError: allFailed ? "annotation failed" : undefined,
  });
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index]);
    }
  });
  await Promise.all(runners);
}

async function persistReport(session: Session, report: Report): Promise<Session> {
  const nextSession: Session = { ...session, report, status: "finished" };
  await updateSession(session.id, { report, status: "finished" }, session.ownerId);
  await saveInterviewRecord(nextSession);
  return nextSession;
}

function withAnnotationStatus(
  report: Report,
  annotationStatus: NonNullable<Report["annotationStatus"]>,
  metadata: Partial<
    Pick<Report, "annotationStartedAt" | "annotationFinishedAt" | "annotationError">
  > = {}
): Report {
  return {
    ...report,
    annotationStatus,
    ...metadata,
    roundReviews: report.roundReviews ?? [],
    answerAnnotations: report.answerAnnotations ?? [],
    annotationSummaries: report.annotationSummaries ?? [],
  };
}

function isStaleRunningAnnotation(report: Report): boolean {
  const startedAt = report.annotationStartedAt;
  return !startedAt || Date.now() - startedAt > ANNOTATION_RUNNING_STALE_MS;
}
