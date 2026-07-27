import type { LLMOverride } from "../llm";
import type { InterviewHistoryRecord } from "../historyStore";
import type { ConsultGoal, ConsultMessage, ConsultSummary } from "../consultation/types";
import { runConsultAgent } from "../consultation/langgraphAgent";

export function isConsultStopIntent(text: string): boolean {
  const normalized = text.trim().replace(/[，。！？\s]/g, "");
  if (!normalized) return false;
  return [
    "结束",
    "停止",
    "先到这",
    "先到这里",
    "不用继续了",
    "总结一下",
    "咨询一下结论",
    "给我一个结论",
    "帮我生成总结",
    "帮我生成咨询结论",
    "今天先这样",
    "可以了",
  ].some((phrase) => normalized.includes(phrase));
}

export async function generateConsultOpening(params: {
  records: InterviewHistoryRecord[];
  goal: ConsultGoal;
  memoryDigest?: string;
  llm?: LLMOverride;
}): Promise<string> {
  const result = await runConsultAgent({
    task: "opening",
    records: params.records,
    goal: params.goal,
    memoryDigest: params.memoryDigest,
    llm: params.llm,
  });
  return result.task === "opening" ? result.message : fallbackOpening(params.records);
}

export async function generateConsultReply(params: {
  records: InterviewHistoryRecord[];
  goal: ConsultGoal;
  messages: ConsultMessage[];
  userMessage: string;
  memoryDigest?: string;
  conversationCoverageDigest?: string;
  llm?: LLMOverride;
}): Promise<string> {
  const result = await runConsultAgent({
    task: "reply",
    records: params.records,
    goal: params.goal,
    messages: params.messages,
    userMessage: params.userMessage,
    memoryDigest: params.memoryDigest,
    conversationCoverageDigest: params.conversationCoverageDigest,
    llm: params.llm,
  });
  return result.task === "reply"
    ? result.message
    : "先给你一个初步想法：这个问题可以再聚焦一些。方便补充一句吗——你目前最想解决的，是方向选择，还是下一场面试如何提升？";
}

export async function generateConsultSummary(params: {
  records: InterviewHistoryRecord[];
  goal: ConsultGoal;
  messages: ConsultMessage[];
  memoryDigest?: string;
  conversationCoverageDigest?: string;
  llm?: LLMOverride;
}): Promise<{ summary: ConsultSummary; closingMessage: string }> {
  const result = await runConsultAgent({
    task: "summary",
    records: params.records,
    goal: params.goal,
    messages: params.messages,
    memoryDigest: params.memoryDigest,
    conversationCoverageDigest: params.conversationCoverageDigest,
    llm: params.llm,
  });

  if (result.task !== "summary") {
    return {
      summary: fallbackSummary(),
      closingMessage: fallbackClosingMessage(),
    };
  }

  return {
    summary: result.summary,
    closingMessage: result.closingMessage,
  };
}

function fallbackOpening(records: InterviewHistoryRecord[]): string {
  if (!records[0]) return "一个直接的判断：你当前缺的不是建议，而是先积累几场真实的面试记录作为依据。";
  const titles = records
    .slice(0, 3)
    .map((record) => `${record.company} · ${record.jobTitle}`)
    .join("；");
  return `先做一个简要梳理。本次共分析 ${records.length} 场面试${titles ? `，主要包括 ${titles}` : ""}。整体有一定基础，只是部分回答还没有完全讲透。你可以直接提出：方向如何选择、下一场优先练什么、某段回答如何改进，或者几场面试反复卡在哪里。请提出你的问题，我会围绕它逐项分析。`;
}

function fallbackSummary(): ConsultSummary {
  return {
    currentJudgement: "你当前最需要解决的是目标聚焦和回答证据链问题。",
    primaryTarget: "继续围绕当前得分更稳定的岗位方向训练",
    notRecommended: ["短期内不要同时分散准备太多方向"],
    repeatedIssues: ["项目回答缺少难点、行动和结果"],
    nextPracticeFocus: ["优先练项目深挖和岗位动机"],
    sevenDayPlan: ["整理历史面试问题", "重写一个核心项目回答", "再完成一次针对性模拟"],
  };
}

function fallbackClosingMessage(): string {
  return "我直接说，方向别再散了。你现在不是没机会，是主线还不够清楚。先把一条线练扎实，把项目讲透，把岗位动机说硬。比你同时试三条路强得多。";
}
