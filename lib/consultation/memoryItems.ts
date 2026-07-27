import type { ConsultMessage, ConsultSession, ConsultTopic } from "./types";
import { getSupabaseClient } from "../supabase";

export type UserMemoryItemType =
  | "user_profile"
  | "interview_evidence"
  | "consultation_memory"
  | "common_issues";

export type UserMemoryItemStatus = "active" | "disabled" | "user_removed" | "superseded";

export type UserMemoryItemSourceType =
  | "interview"
  | "report"
  | "consultation"
  | "manual_edit";

export type ConsultMemoryItem = {
  id: string;
  ownerId: string;
  profileId: string;
  type: UserMemoryItemType;
  content: string;
  sourceType: UserMemoryItemSourceType;
  sourceId: string;
  sourceTitle: string | null;
  quoteOrSummary: string | null;
  confidence: number;
  status: UserMemoryItemStatus;
  tags: string[];
  metadata: Record<string, unknown>;
  occurrenceCount: number;
  createdAt: number;
  updatedAt: number;
  lastSeenAt: number;
};

export type ConsultMemoryItemDraft = {
  ownerId: string;
  profileId: string;
  type: UserMemoryItemType;
  content: string;
  sourceType: UserMemoryItemSourceType;
  sourceId: string;
  sourceTitle: string;
  quoteOrSummary: string;
  confidence: number;
  status: UserMemoryItemStatus;
  tags: string[];
  metadata: Record<string, unknown>;
  occurrenceCount: number;
  lastSeenAt: number;
};

const USER_MEMORY_TABLE = "user_memory_items";

const TOPIC_KEYWORDS: Array<{ topic: ConsultTopic; label: string; keywords: string[] }> = [
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

export function extractConsultMemoryItemsFromSession(session: ConsultSession): ConsultMemoryItemDraft[] {
  if (!session.summary || session.memoryEnabled === false) return [];

  const sourceTitle = consultSourceTitle(session);
  const lastSeenAt = session.endedAt || session.updatedAt || session.createdAt;
  const base = {
    ownerId: session.ownerId,
    profileId: session.memoryProfileId,
    sourceType: "consultation" as const,
    sourceId: session.id,
    sourceTitle,
    status: "active" as const,
    occurrenceCount: 1,
    lastSeenAt,
  };
  const interviewIds = uniqueInterviewIds(
    session.records.flatMap((record) => [record.id, record.sessionId])
  );
  const memoryItems: ConsultMemoryItemDraft[] = [];

  pushMemory(memoryItems, {
    ...base,
    type: "consultation_memory",
    content: session.summary.currentJudgement,
    quoteOrSummary: session.summary.currentJudgement,
    confidence: 0.86,
    tags: ["judgement"],
    metadata: { goal: session.goal, summaryMode: session.summaryMode, interviewIds },
  });

  pushMemory(memoryItems, {
    ...base,
    type: "user_profile",
    content: session.summary.primaryTarget,
    quoteOrSummary: `建议主攻方向：${session.summary.primaryTarget}`,
    confidence: 0.82,
    tags: ["target_role"],
    metadata: { goal: session.goal, summaryMode: session.summaryMode, interviewIds },
  });

  for (const item of session.summary.notRecommended) {
    pushMemory(memoryItems, {
      ...base,
      type: "user_profile",
      content: item,
      quoteOrSummary: `暂不建议方向：${item}`,
      confidence: 0.78,
      tags: ["avoid_role"],
      metadata: { goal: session.goal, summaryMode: session.summaryMode, interviewIds },
    });
  }

  for (const item of session.summary.repeatedIssues) {
    pushMemory(memoryItems, {
      ...base,
      type: "common_issues",
      content: item,
      quoteOrSummary: `战略咨询识别出的反复问题：${item}`,
      confidence: 0.9,
      tags: ["repeated_issue"],
      metadata: { goal: session.goal, summaryMode: session.summaryMode, interviewIds },
    });
  }

  for (const item of session.summary.nextPracticeFocus) {
    pushMemory(memoryItems, {
      ...base,
      type: "consultation_memory",
      content: item,
      quoteOrSummary: `下一场训练重点：${item}`,
      confidence: 0.82,
      tags: ["practice_focus"],
      metadata: { goal: session.goal, summaryMode: session.summaryMode, interviewIds },
    });
  }

  for (const item of session.summary.sevenDayPlan) {
    pushMemory(memoryItems, {
      ...base,
      type: "consultation_memory",
      content: item,
      quoteOrSummary: `7天行动计划：${item}`,
      confidence: 0.76,
      tags: ["action_plan"],
      metadata: { goal: session.goal, summaryMode: session.summaryMode, interviewIds },
    });
  }

  for (const question of extractQuestionCandidates(session.messages)) {
    pushMemory(memoryItems, {
      ...base,
      type: "consultation_memory",
      content: question,
      quoteOrSummary: `历史咨询已追问：${question}`,
      confidence: 0.7,
      tags: ["asked_question"],
      metadata: { goal: session.goal, summaryMode: session.summaryMode, interviewIds },
    });
  }

  for (const topic of inferTopicsFromSession(session)) {
    pushMemory(memoryItems, {
      ...base,
      type: "consultation_memory",
      content: topic.label,
      quoteOrSummary: `历史咨询已覆盖话题：${topic.label}`,
      confidence: 0.72,
      tags: ["covered_topic"],
      metadata: { topic: topic.topic, goal: session.goal, summaryMode: session.summaryMode, interviewIds },
    });
  }

  for (const record of session.records.slice(0, 4)) {
    for (const weakness of (record.report.weaknesses || []).slice(0, 2)) {
      pushMemory(memoryItems, {
        ...base,
        type: "interview_evidence",
        content: weakness,
        quoteOrSummary: `${record.company} · ${record.jobTitle} 报告短板：${weakness}`,
        confidence: 0.74,
        tags: ["interview_weakness"],
        metadata: {
          interviewId: record.id,
          interviewSessionId: record.sessionId,
          company: record.company,
          jobTitle: record.jobTitle,
          overallBand: record.report.overallBand,
        },
      });
    }
  }

  return memoryItems;
}

export async function listConsultMemoryItems(params: {
  ownerId: string;
  profileId: string;
  currentSessionId?: string;
  statuses?: UserMemoryItemStatus[];
  types?: UserMemoryItemType[];
  limit?: number;
}): Promise<ConsultMemoryItem[]> {
  if (!hasSupabaseEnv()) return [];

  try {
    const supabase = getSupabaseClient();
    let query = supabase
      .from(USER_MEMORY_TABLE)
      .select("*")
      .eq("owner_id", params.ownerId)
      .eq("profile_id", params.profileId)
      .order("last_seen_at", { ascending: false })
      .limit(params.limit ?? 80);

    if (params.statuses?.length) query = query.in("status", params.statuses);
    if (params.types?.length) query = query.in("type", params.types);
    if (params.currentSessionId) query = query.neq("source_id", params.currentSessionId);

    const { data, error } = await query;
    if (error) {
      if (isMissingMemoryTableError(error.message)) return [];
      throw error;
    }
    return (data || []).map(rowToMemoryItem);
  } catch (error) {
    if (isMissingMemoryTableError(error instanceof Error ? error.message : String(error))) {
      return [];
    }
    throw error;
  }
}

export async function syncConsultSessionMemoryItems(session: ConsultSession): Promise<void> {
  if (!hasSupabaseEnv() || !session.summary) return;

  const items = extractConsultMemoryItemsFromSession(session);
  if (!items.length) return;

  try {
    const supabase = getSupabaseClient();
    const now = new Date().toISOString();
    const sourceId = session.id;

    const { error: deleteError } = await supabase
      .from(USER_MEMORY_TABLE)
      .delete()
      .eq("owner_id", session.ownerId)
      .eq("profile_id", session.memoryProfileId)
      .eq("source_type", "consultation")
      .eq("source_id", sourceId);

    if (deleteError) {
      if (isMissingMemoryTableError(deleteError.message)) return;
      throw deleteError;
    }

    const rows = items.map((item) => ({
      owner_id: item.ownerId,
      profile_id: item.profileId,
      type: item.type,
      content: item.content,
      source_type: item.sourceType,
      source_id: item.sourceId,
      source_title: item.sourceTitle,
      quote_or_summary: item.quoteOrSummary,
      confidence: item.confidence,
      status: item.status,
      tags: item.tags,
      metadata: item.metadata,
      occurrence_count: item.occurrenceCount,
      last_seen_at: new Date(item.lastSeenAt).toISOString(),
      created_at: now,
      updated_at: now,
    }));

    const { error: insertError } = await supabase.from(USER_MEMORY_TABLE).insert(rows);
    if (insertError && !isMissingMemoryTableError(insertError.message)) throw insertError;
  } catch (error) {
    if (!isMissingMemoryTableError(error instanceof Error ? error.message : String(error))) {
      throw error;
    }
  }
}

export async function setConsultSessionMemoryItemsStatus(params: {
  ownerId: string;
  profileId: string;
  sourceId: string;
  status: UserMemoryItemStatus;
}): Promise<void> {
  if (!hasSupabaseEnv()) return;

  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from(USER_MEMORY_TABLE)
      .update({ status: params.status, updated_at: new Date().toISOString() })
      .eq("owner_id", params.ownerId)
      .eq("profile_id", params.profileId)
      .eq("source_type", "consultation")
      .eq("source_id", params.sourceId);
    if (error && !isMissingMemoryTableError(error.message)) throw error;
  } catch (error) {
    if (!isMissingMemoryTableError(error instanceof Error ? error.message : String(error))) {
      throw error;
    }
  }
}

export async function deleteConsultSessionMemoryItems(params: {
  ownerId: string;
  sourceId: string;
}): Promise<void> {
  if (!hasSupabaseEnv()) return;

  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from(USER_MEMORY_TABLE)
      .delete()
      .eq("owner_id", params.ownerId)
      .eq("source_type", "consultation")
      .eq("source_id", params.sourceId);
    if (error && !isMissingMemoryTableError(error.message)) throw error;
  } catch (error) {
    if (!isMissingMemoryTableError(error instanceof Error ? error.message : String(error))) {
      throw error;
    }
  }
}

export async function setCommonIssueMemoryStatusByKey(params: {
  normalizedKey: string;
  ownerId?: string;
  profileId: string;
  status: UserMemoryItemStatus;
}): Promise<void> {
  if (!hasSupabaseEnv() || !params.normalizedKey) return;

  const items = await listConsultMemoryItems({
    ownerId: params.ownerId ?? ownerIdFromProfile(params.profileId) ?? "",
    profileId: params.profileId,
    statuses: ["active", "disabled", "user_removed"],
    types: ["common_issues"],
    limit: 200,
  });
  const matchedIds = items
    .filter((item) => normalizeMemoryKey(item.content) === params.normalizedKey)
    .map((item) => item.id);
  if (!matchedIds.length) return;

  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from(USER_MEMORY_TABLE)
    .update({ status: params.status, updated_at: new Date().toISOString() })
    .in("id", matchedIds);
  if (error && !isMissingMemoryTableError(error.message)) throw error;
}

export function normalizeMemoryKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[""'"".?？!！,，。；;：:\s、\-—_]/g, "")
    .replace(/^(问题|短板|建议|主要问题|提高建议|下次优先)/, "")
    .slice(0, 80)
    .trim();
}

function pushMemory(items: ConsultMemoryItemDraft[], item: ConsultMemoryItemDraft) {
  const content = cleanContent(item.content);
  if (!content) return;
  const normalized = normalizeMemoryKey(content);
  if (!normalized) return;
  const duplicate = items.some(
    (existing) =>
      existing.type === item.type &&
      normalizeMemoryKey(existing.content) === normalized &&
      hasSameTagGroup(existing.tags, item.tags)
  );
  if (duplicate) return;
  items.push({
    ...item,
    content,
    quoteOrSummary: cleanContent(item.quoteOrSummary) || content,
  });
}

function uniqueInterviewIds(values: string[]): string[] {
  return Array.from(new Set(values.map((item) => item.trim()).filter(Boolean)));
}

function inferTopicsFromSession(session: ConsultSession): Array<{ topic: ConsultTopic; label: string }> {
  const text = [
    session.summary?.currentJudgement,
    session.summary?.primaryTarget,
    ...(session.summary?.repeatedIssues || []),
    ...(session.summary?.nextPracticeFocus || []),
    ...(session.summary?.sevenDayPlan || []),
    ...session.records.flatMap((record) => [
      record.jobTitle,
      record.company,
      ...(record.report.weaknesses || []),
      ...(record.report.improvementAdvice || []),
    ]),
  ]
    .filter(Boolean)
    .join("\n")
    .replace(/\s+/g, "");

  return TOPIC_KEYWORDS.filter((rule) => rule.keywords.some((keyword) => text.includes(keyword))).map((rule) => ({
    topic: rule.topic,
    label: rule.label,
  }));
}

function extractQuestionCandidates(messages: ConsultMessage[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    const matches = message.content.match(/[^？?\n]{4,48}[？?]/g) || [];
    for (const match of matches) {
      const question = cleanContent(match.replace(/[？?]/g, ""));
      const key = normalizeMemoryKey(question);
      if (!question || seen.has(key)) continue;
      seen.add(key);
      result.push(question);
      if (result.length >= 6) return result;
    }
  }
  return result;
}

function consultSourceTitle(session: ConsultSession): string {
  if (session.records.length === 1) {
    const record = session.records[0];
    return `${record.jobTitle} · ${record.company}`;
  }
  return `战略咨询 ${session.records.length} 场面试`;
}

function cleanContent(value: string): string {
  return value.replace(/\s+/g, " ").replace(/^[-•\d.、\s]+/, "").trim().slice(0, 220);
}

function hasSameTagGroup(left: string[], right: string[]): boolean {
  return left[0] === right[0];
}

function rowToMemoryItem(row: Record<string, unknown>): ConsultMemoryItem {
  return {
    id: row.id as string,
    ownerId: row.owner_id as string,
    profileId: row.profile_id as string,
    type: row.type as UserMemoryItemType,
    content: row.content as string,
    sourceType: row.source_type as UserMemoryItemSourceType,
    sourceId: row.source_id as string,
    sourceTitle: (row.source_title as string | null) ?? null,
    quoteOrSummary: (row.quote_or_summary as string | null) ?? null,
    confidence: typeof row.confidence === "number" ? row.confidence : Number(row.confidence ?? 0.75),
    status: row.status as UserMemoryItemStatus,
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
    metadata: (row.metadata as Record<string, unknown>) || {},
    occurrenceCount: Number(row.occurrence_count ?? 1),
    createdAt: new Date(row.created_at as string).getTime(),
    updatedAt: new Date(row.updated_at as string).getTime(),
    lastSeenAt: new Date(row.last_seen_at as string).getTime(),
  };
}

function hasSupabaseEnv(): boolean {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function isMissingMemoryTableError(message: string): boolean {
  return message.includes(USER_MEMORY_TABLE) || message.includes("Could not find the table") || message.includes("does not exist");
}

function ownerIdFromProfile(profileId: string): string | undefined {
  return profileId.startsWith("user:") ? profileId.slice("user:".length) : undefined;
}
