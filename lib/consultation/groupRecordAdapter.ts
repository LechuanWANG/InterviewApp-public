import type { InterviewHistoryRecord } from "@/lib/historyStore";
import type { Report, ReportDimension, Round } from "@/lib/types";
import type { GroupInterviewSession, GroupTurn } from "@/lib/groupInterview/types";

/**
 * 把一场「智能群面」会话适配成战略咨询可消费的 InterviewHistoryRecord，
 * 使群面记录能与一对一记录同构地进入咨询诊断（开场白/记忆/技能/总结链路无需改动）。
 * 没有报告（未完成）的场次返回 null，不纳入分析。
 */
export function groupSessionToConsultRecord(
  session: GroupInterviewSession
): InterviewHistoryRecord | null {
  const gr = session.report;
  if (!gr) return null;

  const personal = gr.personal;
  const dimensionScores = Object.fromEntries(
    Object.entries(personal.dimensions ?? {}).map(([key, detail]) => [key, detail?.score ?? 0])
  ) as Record<ReportDimension, number>;

  const overall = typeof personal.overallScore === "number" ? personal.overallScore : 0;

  // 咨询的 recordsDigest 只读 overallBand / dimensionScores / strengths / weaknesses /
  // improvementAdvice / roundReviews，这里只填这些 + 安全默认，其余用 as Report 收口。
  const report = {
    overallBand: overall,
    overallScore: overall,
    rawOverall: overall,
    penalty: 0,
    difficultyAdjustment: 0,
    weights: {} as Record<ReportDimension, number>,
    dimensionScores,
    categoryScores: {} as Record<ReportDimension, number>,
    dimensionDetails: {},
    penalties: [],
    roundReviews: [],
    answerAnnotations: [],
    annotationSummaries: [],
    strengths: personal.strengths ?? [],
    weaknesses: personal.weaknesses ?? [],
    improvementAdvice: personal.advice ?? [],
    betterAnswers: [],
  } as unknown as Report;

  return {
    id: session.id,
    ownerId: session.ownerId,
    sessionId: session.id,
    resume: session.resume,
    company: session.company,
    jobTitle: session.jobTitle,
    jd: session.jd,
    interviewType: "behavioral",
    language: session.language,
    persona: "pro_expert",
    difficulty: session.difficulty,
    mode: "simulate",
    rounds: buildRounds(session),
    report,
    createdAt: session.createdAt,
    reportedAt: session.createdAt,
    format: "group",
  };
}

function buildRounds(session: GroupInterviewSession): Round[] {
  const rounds: Round[] = [];
  // 首条交代形式与全局背景，让咨询师明确这是群面证据。
  rounds.push({
    question: "面试形式",
    answer:
      `无领导小组讨论（群面）。题目：${session.topic?.title ?? "（未知）"}` +
      (session.report?.group?.summary ? `；群体结论：${session.report.group.summary}` : ""),
    isFollowUp: false,
  });
  for (const turn of session.transcript) {
    if (turn.speakerId !== "user") continue;
    const text = (turn.text || "").trim();
    if (!text) continue;
    rounds.push({
      question: userTurnLabel(turn),
      answer: text,
      isFollowUp: turn.kind === "speech",
    });
  }
  return rounds;
}

function userTurnLabel(turn: GroupTurn): string {
  if (turn.kind === "statement") return "个人陈述";
  if (turn.kind === "report") return "代表总结汇报";
  return "自由讨论发言";
}
