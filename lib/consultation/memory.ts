import type {
  ConsultMemoryGraphSnapshot,
  ConsultMemorySnapshot,
  ConsultMemorySourceItem,
  ConsultMessage,
  ConsultSession,
  ConsultTopic,
  ConsultTopicStat,
} from "./types";
import { getConsultMemoryProfile } from "./memoryProfile";
import {
  getConsultMemoryGraphSnapshot,
} from "./memoryGraph";
import { getResolvedIssueKeys, normalizeIssueKey } from "./issues";
import {
  listConsultMemoryItems,
  normalizeMemoryKey,
  type ConsultMemoryItem,
} from "./memoryItems";
import { memoryItemInterviewKeys } from "./memoryCoverage";
import { buildSelectedConsultMemoryDigest } from "./memorySelector";
import type { ConsultTurnIntent } from "./intent";

export const DEFAULT_CONSULT_PROFILE_ID = "local-default-user";

const TOPIC_RULES: Array<{ topic: ConsultTopic; label: string; keywords: string[] }> = [
  {
    topic: "job_direction",
    label: "岗位方向",
    keywords: ["方向", "岗位", "转岗", "赛道", "选择", "主攻", "求职目标"],
  },
  {
    topic: "job_motivation",
    label: "岗位动机",
    keywords: ["动机", "为什么投", "为什么选择", "想做", "兴趣", "匹配"],
  },
  {
    topic: "project_depth",
    label: "项目深挖",
    keywords: ["项目", "实习", "经历", "案例", "负责", "难点", "贡献"],
  },
  {
    topic: "expression_logic",
    label: "逻辑表达",
    keywords: ["逻辑", "表达", "结构", "讲清楚", "条理", "沟通"],
  },
  {
    topic: "evidence_results",
    label: "结果证据",
    keywords: ["数据", "指标", "结果", "证据", "量化", "产出", "效果"],
  },
  {
    topic: "practice_plan",
    label: "练习计划",
    keywords: ["练习", "计划", "准备", "复盘", "训练", "下一步"],
  },
  {
    topic: "resume_background",
    label: "简历背景",
    keywords: ["简历", "专业", "学历", "背景", "学校", "教育"],
  },
  {
    topic: "team_communication",
    label: "团队协作",
    keywords: ["团队", "协作", "沟通", "同学", "同事", "冲突", "合作"],
  },
];

export async function buildConsultMemorySnapshot(params: {
  sessions: ConsultSession[];
  currentSessionId?: string;
  profileId?: string;
  ownerId?: string;
  includeGraph?: boolean;
}): Promise<ConsultMemorySnapshot> {
  const profileId = params.profileId || DEFAULT_CONSULT_PROFILE_ID;
  const resolvedIssueKeys = await getResolvedIssueKeys(profileId);
  const graph = params.ownerId && params.includeGraph
    ? await getConsultMemoryGraphSnapshot({
        ownerId: params.ownerId,
        profileId,
      })
    : null;
  const structuredSnapshot = params.ownerId
    ? await buildStructuredMemorySnapshot({
        ownerId: params.ownerId,
        profileId,
        currentSessionId: params.currentSessionId,
        resolvedIssueKeys,
        graph,
      })
    : null;
  if (structuredSnapshot) return structuredSnapshot;

  const compactProfile = params.ownerId
    ? await getConsultMemoryProfile({ ownerId: params.ownerId, profileId })
    : null;

  const sessions = params.sessions
    .filter(
      (session) =>
        session.id !== params.currentSessionId &&
        session.memoryProfileId === profileId &&
        session.memoryEnabled !== false &&
        getMemorySaveStatus(session) === "saved" &&
        (session.status === "completed" || !!session.summary)
    )
    .sort((left, right) => (right.endedAt || right.updatedAt) - (left.endedAt || left.updatedAt));

  const targetRoles = createTextCollector(5);
  const avoidRoles = createTextCollector(5);
  const repeatedIssues = createTextCollector(6);
  const recentAdvice = createTextCollector(6);
  const recentQuestions = createTextCollector(6);
  const topicCounts = new Map<ConsultTopic, number>();
  let latestJudgement: string | null = null;
  let latestPrimaryTarget: string | null = null;
  let updatedAt: number | null = null;

  for (const session of sessions) {
    const sessionTopics = new Set<ConsultTopic>();

    for (const record of session.records) {
      targetRoles.push(record.jobTitle);
      collectTopics(record.jobTitle, sessionTopics);
      for (const weakness of record.report.weaknesses || []) {
        if (isResolvedIssue(weakness, resolvedIssueKeys)) continue;
        collectTopics(weakness, sessionTopics);
      }
      for (const advice of record.report.improvementAdvice || []) {
        if (isResolvedIssue(advice, resolvedIssueKeys)) continue;
        collectTopics(advice, sessionTopics);
      }
      for (const review of record.report.roundReviews || []) {
        collectTopics(review.overallComment, sessionTopics);
        if (!isResolvedIssue(review.mainIssue || "", resolvedIssueKeys)) {
          collectTopics(review.mainIssue || "", sessionTopics);
        }
        collectTopics(review.mainStrength || "", sessionTopics);
        if (!isResolvedIssue(review.nextStep || "", resolvedIssueKeys)) {
          collectTopics(review.nextStep || "", sessionTopics);
        }
      }
    }

    for (const message of session.messages) {
      collectTopics(message.content, sessionTopics);
      if (message.role === "assistant") {
        for (const question of extractQuestionCandidates(message.content)) {
          recentQuestions.push(question);
        }
      }
    }

    if (session.summary) {
      if (!latestJudgement) latestJudgement = session.summary.currentJudgement;
      if (!latestPrimaryTarget) latestPrimaryTarget = session.summary.primaryTarget;
      repeatedIssues.pushMany(session.summary.repeatedIssues.filter((item) => !isResolvedIssue(item, resolvedIssueKeys)));
      recentAdvice.pushMany(session.summary.nextPracticeFocus.filter((item) => !isResolvedIssue(item, resolvedIssueKeys)));
      recentAdvice.pushMany(session.summary.sevenDayPlan.filter((item) => !isResolvedIssue(item, resolvedIssueKeys)));
      avoidRoles.pushMany(session.summary.notRecommended);
      targetRoles.push(session.summary.primaryTarget);
      collectTopics(session.summary.currentJudgement, sessionTopics);
      collectTopics(session.summary.primaryTarget, sessionTopics);
      session.summary.repeatedIssues
        .filter((item) => !isResolvedIssue(item, resolvedIssueKeys))
        .forEach((item) => collectTopics(item, sessionTopics));
      session.summary.nextPracticeFocus
        .filter((item) => !isResolvedIssue(item, resolvedIssueKeys))
        .forEach((item) => collectTopics(item, sessionTopics));
      session.summary.sevenDayPlan
        .filter((item) => !isResolvedIssue(item, resolvedIssueKeys))
        .forEach((item) => collectTopics(item, sessionTopics));
    }

    for (const topic of sessionTopics) {
      topicCounts.set(topic, (topicCounts.get(topic) || 0) + 1);
    }

    if (updatedAt === null) {
      updatedAt = session.endedAt || session.updatedAt || session.createdAt;
    }
  }

  const discussedTopics: ConsultTopicStat[] = Array.from(topicCounts.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)
    .map(([topic, count]) => ({
      topic,
      count,
      label: TOPIC_RULES.find((item) => item.topic === topic)?.label || topic,
    }));

  return {
    profileId,
    pastSessionCount: Math.max(sessions.length, compactProfile?.sourceSessionCount || 0, graph?.sourceSessionCount || 0),
    compactProfile,
    graph,
    sourceItems: [],
    latestJudgement,
    latestPrimaryTarget,
    targetRoles: targetRoles.values(),
    avoidRoles: avoidRoles.values(),
    repeatedIssues: repeatedIssues.values(),
    recentAdvice: recentAdvice.values(),
    discussedTopics,
    recentQuestions: recentQuestions.values(),
    updatedAt,
  };
}

async function buildStructuredMemorySnapshot(params: {
  ownerId: string;
  profileId: string;
  currentSessionId?: string;
  resolvedIssueKeys: Set<string>;
  graph?: ConsultMemoryGraphSnapshot | null;
}): Promise<ConsultMemorySnapshot | null> {
  const items = await listConsultMemoryItems({
    ownerId: params.ownerId,
    profileId: params.profileId,
    currentSessionId: params.currentSessionId,
    statuses: ["active"],
    limit: 120,
  });
  const compactProfile = await getConsultMemoryProfile({
    ownerId: params.ownerId,
    profileId: params.profileId,
  });
  if (!items.length && !compactProfile && !params.graph) return null;

  const activeItems = items.filter((item) => !isResolvedMemoryItem(item, params.resolvedIssueKeys));
  if (!activeItems.length && !compactProfile && !params.graph) {
    return {
      profileId: params.profileId,
      pastSessionCount: 0,
      compactProfile: null,
      graph: params.graph,
      sourceItems: [],
      latestJudgement: null,
      latestPrimaryTarget: null,
      targetRoles: [],
      avoidRoles: [],
      repeatedIssues: [],
      recentAdvice: [],
      discussedTopics: [],
      recentQuestions: [],
      updatedAt: null,
    };
  }

  const sourceIds = new Set(
    activeItems.flatMap((item) => {
      const interviewKeys = memoryItemInterviewKeys(item.metadata);
      return interviewKeys.length ? interviewKeys.map((key) => `interview:${key}`) : [item.sourceId];
    })
  );
  const targetRoles = pickMemoryContents(activeItems, (item) => item.tags.includes("target_role"), 5);
  const avoidRoles = pickMemoryContents(activeItems, (item) => item.tags.includes("avoid_role"), 5);
  const repeatedIssues = pickMemoryContents(
    activeItems,
    (item) => item.type === "common_issues" || item.tags.includes("repeated_issue"),
    6
  );
  const recentAdvice = pickMemoryContents(
    activeItems,
    (item) => item.tags.includes("practice_focus") || item.tags.includes("action_plan"),
    6
  );
  const recentQuestions = pickMemoryContents(activeItems, (item) => item.tags.includes("asked_question"), 6);
  const latestJudgement = pickMemoryContents(activeItems, (item) => item.tags.includes("judgement"), 1)[0] ?? null;
  const latestPrimaryTarget = targetRoles[0] ?? null;
  const topicCounts = new Map<ConsultTopic, number>();

  for (const item of activeItems) {
    const topic = typeof item.metadata.topic === "string" ? (item.metadata.topic as ConsultTopic) : undefined;
    if (topic) {
      topicCounts.set(topic, (topicCounts.get(topic) || 0) + 1);
    } else {
      const topics = new Set<ConsultTopic>();
      collectTopics(item.content, topics);
      for (const inferred of topics) {
        topicCounts.set(inferred, (topicCounts.get(inferred) || 0) + 1);
      }
    }
  }

  const discussedTopics: ConsultTopicStat[] = Array.from(topicCounts.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)
    .map(([topic, count]) => ({
      topic,
      count,
      label: TOPIC_RULES.find((item) => item.topic === topic)?.label || topic,
    }));

  return {
    profileId: params.profileId,
    pastSessionCount: Math.max(sourceIds.size, compactProfile?.sourceSessionCount || 0, params.graph?.sourceSessionCount || 0),
    compactProfile,
    graph: params.graph,
    sourceItems: activeItems.slice(0, 24).map(toSourceItem),
    latestJudgement: latestJudgement ?? compactProfile?.compactSummary ?? null,
    latestPrimaryTarget: latestPrimaryTarget ?? compactProfile?.currentTarget ?? null,
    targetRoles,
    avoidRoles,
    repeatedIssues,
    recentAdvice,
    discussedTopics,
    recentQuestions,
    updatedAt: activeItems[0]?.lastSeenAt ?? compactProfile?.updatedAt ?? null,
  };
}

function isResolvedMemoryItem(item: ConsultMemoryItem, resolvedIssueKeys: Set<string>): boolean {
  if (!item.content || !resolvedIssueKeys.size) return false;
  return resolvedIssueKeys.has(normalizeMemoryKey(item.content));
}

function pickMemoryContents(
  items: ConsultMemoryItem[],
  predicate: (item: ConsultMemoryItem) => boolean,
  limit: number
): string[] {
  return uniqueTexts(
    items
      .filter(predicate)
      .sort((left, right) => right.lastSeenAt - left.lastSeenAt || right.confidence - left.confidence)
      .map((item) => item.content),
    limit
  );
}

function toSourceItem(item: ConsultMemoryItem): ConsultMemorySourceItem {
  return {
    type: item.type,
    content: item.content,
    sourceTitle: item.sourceTitle,
    quoteOrSummary: item.quoteOrSummary,
    confidence: item.confidence,
    tags: item.tags,
    lastSeenAt: item.lastSeenAt,
  };
}

function isResolvedIssue(text: string, resolvedIssueKeys: Set<string>): boolean {
  return !!text && resolvedIssueKeys.has(normalizeIssueKey(text));
}

function getMemorySaveStatus(session: ConsultSession): "pending" | "saved" | "excluded" {
  if (
    session.memorySaveStatus === "pending" ||
    session.memorySaveStatus === "saved" ||
    session.memorySaveStatus === "excluded"
  ) {
    return session.memorySaveStatus;
  }
  return session.memoryEnabled === false ? "excluded" : "saved";
}

export function buildConsultMemoryDigest(
  memory: ConsultMemorySnapshot,
  options: { userMessage?: string; turnIntent?: ConsultTurnIntent; maxChars?: number } = {}
): string {
  return buildSelectedConsultMemoryDigest({
    memory,
    userMessage: options.userMessage,
    turnIntent: options.turnIntent,
    maxChars: options.maxChars,
  });
}

function memoryTypeLabel(type: ConsultMemorySourceItem["type"]): string {
  if (type === "user_profile") return "用户画像";
  if (type === "interview_evidence") return "面试证据";
  if (type === "common_issues") return "共性问题";
  return "咨询记忆";
}

export function buildConversationCoverageDigest(messages: ConsultMessage[]): string {
  if (!messages.length) {
    return "当前会话刚开始，尚无已覆盖内容。";
  }

  const topics = new Set<ConsultTopic>();
  const questions = createTextCollector(4);

  for (const message of messages) {
    collectTopics(message.content, topics);
    if (message.role === "assistant") {
      for (const question of extractQuestionCandidates(message.content)) {
        questions.push(question);
      }
    }
  }

  const topicLabels = Array.from(topics)
    .map((topic) => TOPIC_RULES.find((item) => item.topic === topic)?.label || topic)
    .slice(0, 5);

  const lines = [];
  lines.push(
    topicLabels.length ? `当前会话已覆盖话题：${topicLabels.join("、")}` : "当前会话尚未形成明确话题。"
  );
  if (questions.values().length) {
    lines.push(`当前会话已经问过的问题：${questions.values().join("；")}`);
  }
  lines.push("不要换个说法重复问同一层问题；如果要继续追问，必须更深入，或者推进到下一步建议。");
  return lines.join("\n");
}

function collectTopics(text: string, bucket: Set<ConsultTopic>) {
  const normalized = normalizeText(text);
  if (!normalized) return;
  for (const rule of TOPIC_RULES) {
    if (rule.keywords.some((keyword) => normalized.includes(keyword))) {
      bucket.add(rule.topic);
    }
  }
}

function extractQuestionCandidates(text: string): string[] {
  const matches = text.match(/[^？?\n]{4,48}[？?]/g) || [];
  return uniqueTexts(matches.map((item) => item.replace(/[？?]/g, "").trim()), 6);
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, "").trim();
}

function uniqueTexts(items: string[], limit: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const normalized = item.replace(/[，。！？；、\s]/g, "");
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(item);
    if (result.length >= limit) break;
  }
  return result;
}

function createTextCollector(limit: number) {
  const items: string[] = [];
  return {
    push(value: string) {
      if (!value?.trim()) return;
      const next = uniqueTexts([value.trim(), ...items], limit);
      items.splice(0, items.length, ...next);
    },
    pushMany(values: string[]) {
      for (const value of values) this.push(value);
    },
    values() {
      return items.slice(0, limit);
    },
  };
}
