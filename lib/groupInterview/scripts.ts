import type { GroupInterviewSession } from "./types";

// 确定性脚本文案(HR 开场 / 收尾 / 汇报引导)，无需 LLM，稳定可靠。

export function buildHostOpening(session: GroupInterviewSession): string {
  const { language, durations, topic } = session;
  const thinkMin = Math.round(durations.thinkSec / 60);
  const stmtMin = Math.max(1, Math.round(durations.statementSecPerPerson / 60));
  const discussMin = Math.round(durations.discussSec / 60);
  if (language === "en") {
    return `Hello everyone, welcome to today's group discussion. I'm your HR host. There are 5 of you in this group. Here is today's topic: "${topic.title}". You'll have ${thinkMin} minute(s) to read and think, then each person gives a brief statement (up to ${stmtMin} minute each), followed by ${discussMin} minutes of open discussion. Finally one representative will report to the interviewer. Let's begin — please read the topic.`;
  }
  return `各位同学好，欢迎参加今天的小组讨论，我是本场的 HR 主持人。本组共 5 位同学。今天的讨论题目是：「${topic.title}」。请大家先用 ${thinkMin} 分钟阅读和思考，随后每人做一个简短的个人陈述（每人 ${stmtMin} 分钟以内），接着进入 ${discussMin} 分钟的自由讨论，最后由一位同学代表小组向面试官汇报。现在开始，请大家先阅读题目。`;
}

export function buildDiscussionStart(session: GroupInterviewSession): string {
  if (session.language === "en") {
    return "Time's up for statements. Now let's open the floor for free discussion. Feel free to build on each other and reach a conclusion together.";
  }
  return "个人陈述时间到，现在进入自由讨论环节，大家可以相互补充、讨论，争取形成一个小组结论。";
}

export function buildReportingPrompt(session: GroupInterviewSession, reporterIsUser: boolean): string {
  if (session.language === "en") {
    return reporterIsUser
      ? "Discussion time is up. You've been chosen to represent the group. Please give a structured summary to the interviewer: background → consensus → key disagreements → recommendation."
      : "Discussion time is up. A representative will now summarize the group's conclusion to the interviewer.";
  }
  return reporterIsUser
    ? "讨论时间到。你被推选为小组代表，请面向面试官做一个结构化汇报：背景 → 共识结论 → 关键分歧 → 建议。"
    : "讨论时间到，现在由小组代表向面试官汇报讨论结论。";
}
