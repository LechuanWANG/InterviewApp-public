import { annotateGroupTurn, userTurns } from "./prompts/annotate";
import { generateGroupReport } from "./prompts/report";
import { getGroupSession, updateGroupSession } from "./store";
import type {
  GroupInterviewSession,
  GroupReport,
  GroupTurnAnnotation,
  GroupTurnReview,
} from "./types";

const ANNOTATION_RUNNING_STALE_MS = 4 * 60 * 1000;
// 逐条批注的最大并发：用户每条发言单独一次 LLM 调用，完成一条就增量落库一条。
const TURN_ANNOTATION_CONCURRENCY = 4;

/** 生成「点评」主报告(个人/群体/面试官视角)，并标记批注待生成。已有则直接返回。 */
export async function ensureGroupReport(
  session: GroupInterviewSession
): Promise<GroupInterviewSession> {
  if (session.report) return session;

  const core = await generateGroupReport(session);
  const report: GroupReport = {
    ...core,
    turnReviews: [],
    turnAnnotations: [],
    annotationStatus: "pending",
  };
  const updated = await updateGroupSession(
    session.id,
    { report, phase: "finished", status: "finished" },
    session.ownerId
  );
  return updated ?? { ...session, report, phase: "finished", status: "finished" };
}

/** 逐条流式生成用户发言的「批注 + 逐条点评」，每完成一条即增量落库。 */
export async function ensureGroupReportAnnotations(
  session: GroupInterviewSession
): Promise<GroupInterviewSession> {
  const base = session.report ? session : await ensureGroupReport(session);
  const report = base.report;
  if (!report) throw new Error("group report not generated");

  if (report.annotationStatus === "ready") return base;
  if (report.annotationStatus === "running" && !isStaleRunningAnnotation(report)) return base;

  const turns = userTurns(base);
  const startedAt = Date.now();

  // 进入 running，并清空上一次(可能失败)的批注，避免逐条叠加重复。
  const runningReport: GroupReport = {
    ...report,
    turnReviews: [],
    turnAnnotations: [],
    annotationStatus: "running",
    annotationStartedAt: startedAt,
    annotationFinishedAt: undefined,
    annotationError: undefined,
  };
  await updateGroupSession(base.id, { report: runningReport }, base.ownerId);

  if (turns.length === 0) {
    const ready: GroupReport = {
      ...runningReport,
      annotationStatus: "ready",
      annotationFinishedAt: Date.now(),
    };
    const updated = await updateGroupSession(base.id, { report: ready }, base.ownerId);
    return updated ?? { ...base, report: ready };
  }

  const accReviews: GroupTurnReview[] = [];
  const accAnnotations: GroupTurnAnnotation[] = [];
  let failures = 0;

  const buildSnapshot = (status: NonNullable<GroupReport["annotationStatus"]>): GroupReport => ({
    ...report,
    turnReviews: [...accReviews].sort((a, b) => a.turnIndex - b.turnIndex),
    turnAnnotations: [...accAnnotations],
    annotationStatus: status,
    annotationStartedAt: startedAt,
    annotationFinishedAt: status === "running" ? undefined : Date.now(),
    annotationError: undefined,
  });

  const runTurn = async (turnIndex: number) => {
    try {
      const result = await annotateGroupTurn(base, turnIndex);
      accReviews.push(...result.turnReviews);
      accAnnotations.push(...result.turnAnnotations);
    } catch (error) {
      failures += 1;
      console.warn(`group turn ${turnIndex} annotation failed`, error);
    }
    try {
      await updateGroupSession(base.id, { report: buildSnapshot("running") }, base.ownerId);
    } catch (persistError) {
      console.warn(`group turn ${turnIndex} incremental persist failed`, persistError);
    }
  };

  await runWithConcurrency(
    turns.map((turn) => turn.index),
    TURN_ANNOTATION_CONCURRENCY,
    runTurn
  );

  const allFailed = failures >= turns.length;
  const finalReport: GroupReport = {
    ...buildSnapshot(allFailed ? "failed" : "ready"),
    annotationError: allFailed ? "annotation failed" : undefined,
  };
  const updated = await updateGroupSession(base.id, { report: finalReport }, base.ownerId);
  return updated ?? { ...base, report: finalReport };
}

/** 供路由复用：按 id 读取后确保批注。 */
export async function ensureGroupReportAnnotationsById(
  id: string,
  ownerId: string
): Promise<GroupInterviewSession | undefined> {
  const session = await getGroupSession(id, ownerId);
  if (!session) return undefined;
  return ensureGroupReportAnnotations(session);
}

function isStaleRunningAnnotation(report: GroupReport): boolean {
  const startedAt = report.annotationStartedAt;
  return !startedAt || Date.now() - startedAt > ANNOTATION_RUNNING_STALE_MS;
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
