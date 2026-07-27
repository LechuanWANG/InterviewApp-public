import type { ConsultMemorySnapshot, ConsultMemorySourceItem } from "./types";
import { inferConsultTurnIntent, type ConsultTurnIntent } from "./intent";

type MemorySelectorInput = {
  memory: ConsultMemorySnapshot;
  userMessage?: string;
  turnIntent?: ConsultTurnIntent;
  maxChars?: number;
};

const DEFAULT_MAX_CHARS = 1600;

export function buildSelectedConsultMemoryDigest(input: MemorySelectorInput): string {
  const memory = input.memory;
  if (!memory.pastSessionCount) {
    return "暂无历史战略咨询记忆，这是用户的第一场或尚未完成过战略咨询。";
  }

  const turnIntent = input.turnIntent || inferConsultTurnIntent(input.userMessage || "");
  const keywords = extractKeywords(input.userMessage || "");
  const lines: string[] = [
    `已完成战略咨询 ${memory.pastSessionCount} 场。`,
    "使用原则：只把以下内容作为背景证据和避重提醒；用户当前问题优先级最高，不要机械复述长期记忆。",
  ];

  appendCompactProfile(lines, memory, turnIntent);
  appendSourceItems(lines, memory.sourceItems || [], turnIntent, keywords);
  appendAvoidRepeat(lines, memory);

  return clampDigest(lines.join("\n"), input.maxChars || DEFAULT_MAX_CHARS);
}

function appendCompactProfile(lines: string[], memory: ConsultMemorySnapshot, turnIntent: ConsultTurnIntent) {
  const profile = memory.compactProfile;
  if (!profile?.compactSummary && !memory.latestJudgement && !memory.latestPrimaryTarget) return;

  lines.push("长期画像摘要：");
  const summary = profile?.compactSummary || memory.latestJudgement;
  if (summary) lines.push(`- 摘要：${clean(summary, 260)}`);

  if (profile?.currentTarget || memory.latestPrimaryTarget) {
    lines.push(`- 当前主攻方向：${clean(profile?.currentTarget || memory.latestPrimaryTarget || "", 90)}`);
  }

  if (turnIntent === "direction_judgement" || turnIntent === "free_question") {
    if (profile?.avoidTargets.length) lines.push(`- 暂不建议方向：${profile.avoidTargets.slice(0, 3).join("；")}`);
    if (profile?.stableStrengths.length) lines.push(`- 稳定优势：${profile.stableStrengths.slice(0, 3).join("；")}`);
  }

  if (turnIntent === "common_issues" || turnIntent === "practice_plan" || turnIntent === "single_review") {
    const issues = profile?.recurringIssues.length ? profile.recurringIssues : memory.repeatedIssues;
    if (issues.length) lines.push(`- 反复问题：${issues.slice(0, 4).join("；")}`);
  }

  if (turnIntent === "practice_plan" || turnIntent === "free_question") {
    const focus = profile?.practiceFocus.length ? profile.practiceFocus : memory.recentAdvice;
    if (focus.length) lines.push(`- 训练重点：${focus.slice(0, 4).join("；")}`);
  }

  if (turnIntent === "common_issues" && profile?.resolvedIssues.length) {
    lines.push(`- 已明显缓解：${profile.resolvedIssues.slice(0, 3).join("；")}`);
  }

  if (profile?.recentShift) lines.push(`- 最近变化：${clean(profile.recentShift, 120)}`);
}

function appendSourceItems(
  lines: string[],
  items: ConsultMemorySourceItem[],
  turnIntent: ConsultTurnIntent,
  keywords: string[]
) {
  const selected = items
    .map((item) => ({ item, score: sourceItemScore(item, turnIntent, keywords) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || right.item.lastSeenAt - left.item.lastSeenAt)
    .slice(0, 8)
    .map((entry) => entry.item);

  if (!selected.length) return;

  lines.push("结构化记忆证据：");
  for (const item of selected) {
    const source = item.sourceTitle ? `｜来源：${clean(item.sourceTitle, 50)}` : "";
    const evidence = item.quoteOrSummary && item.quoteOrSummary !== item.content
      ? `｜证据：${clean(item.quoteOrSummary, 70)}`
      : "";
    lines.push(`- [${memoryTypeLabel(item.type)}] ${clean(item.content, 100)}${source}${evidence}`);
  }
}

function appendAvoidRepeat(lines: string[], memory: ConsultMemorySnapshot) {
  const reminders: string[] = [];
  if (memory.recentQuestions.length) {
    reminders.push(`最近已经追问过的问题：${memory.recentQuestions.slice(0, 4).join("；")}`);
  }
  if (memory.discussedTopics.length) {
    reminders.push(
      `已反复讨论：${memory.discussedTopics
        .slice(0, 4)
        .map((item) => item.label)
        .join("、")}`
    );
  }
  if (!reminders.length) return;
  lines.push(`不要重复：${reminders.join("。")}。除非用户主动要求，否则不要把旧问题原样拉回当前对话。`);
}

function sourceItemScore(item: ConsultMemorySourceItem, turnIntent: ConsultTurnIntent, keywords: string[]): number {
  let score = item.confidence * 4;
  const text = `${item.content} ${item.quoteOrSummary || ""} ${item.sourceTitle || ""} ${item.tags.join(" ")}`;
  if (matchesKeywords(text, keywords)) score += 3;
  for (const tag of preferredTags(turnIntent)) {
    if (item.tags.includes(tag)) score += 2.5;
  }
  if (turnIntent === "single_review" && item.type === "interview_evidence") score += 2;
  if (turnIntent === "common_issues" && item.type === "common_issues") score += 2;
  return score;
}

function preferredTags(turnIntent: ConsultTurnIntent): string[] {
  if (turnIntent === "direction_judgement") return ["target_role", "avoid_role", "judgement"];
  if (turnIntent === "single_review") return ["interview_weakness", "practice_focus", "judgement"];
  if (turnIntent === "common_issues") return ["repeated_issue", "interview_weakness", "covered_topic"];
  if (turnIntent === "practice_plan") return ["practice_focus", "action_plan", "repeated_issue"];
  if (turnIntent === "evidence_explain") return ["interview_weakness", "judgement", "target_role"];
  return ["judgement", "target_role", "practice_focus"];
}

function extractKeywords(text: string): string[] {
  return text
    .replace(/[，。！？；、,.!?;:：()[\]{}"'“”‘’]/g, " ")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)
    .slice(0, 12);
}

function matchesKeywords(text: string, keywords: string[]): boolean {
  if (!keywords.length) return false;
  const normalized = text.toLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword.toLowerCase()));
}

function clampDigest(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 42)).trim()}\n（长期记忆已按预算截断，只保留本轮最相关部分。）`;
}

function clean(text: string, limit: number): string {
  return text.replace(/\s+/g, " ").trim().slice(0, limit);
}

function memoryTypeLabel(type: ConsultMemorySourceItem["type"]): string {
  if (type === "user_profile") return "用户画像";
  if (type === "interview_evidence") return "面试证据";
  if (type === "common_issues") return "共性问题";
  return "咨询记忆";
}
