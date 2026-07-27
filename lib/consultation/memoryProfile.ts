import { getLLM, type LLMOverride } from "../llm";
import { getSupabaseClient } from "../supabase";
import type { ConsultMemoryProfile, ConsultSession } from "./types";
import { extractConsultMemoryItemsFromSession, type ConsultMemoryItemDraft } from "./memoryItems";
import { buildMemoryContributionSessions } from "./memoryCoverage";

const MEMORY_PROFILE_TABLE = "consult_memory_profiles";
const MEMORY_PROFILE_VERSION = 1;

type CompactProfileRaw = Partial<{
  compactSummary: string;
  currentTarget: string | null;
  avoidTargets: string[];
  stableStrengths: string[];
  recurringIssues: string[];
  resolvedIssues: string[];
  practiceFocus: string[];
  recentShift: string | null;
  evidenceRefs: string[];
}>;

export async function getConsultMemoryProfile(params: {
  ownerId: string;
  profileId: string;
}): Promise<ConsultMemoryProfile | null> {
  if (!hasSupabaseEnv()) return null;

  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from(MEMORY_PROFILE_TABLE)
      .select("*")
      .eq("owner_id", params.ownerId)
      .eq("profile_id", params.profileId)
      .maybeSingle();

    if (error) {
      if (isMissingProfileTableError(error.message)) return null;
      throw error;
    }
    return data ? rowToMemoryProfile(data) : null;
  } catch (error) {
    if (isMissingProfileTableError(error instanceof Error ? error.message : String(error))) {
      return null;
    }
    throw error;
  }
}

export async function compactConsultMemoryProfile(params: {
  session: ConsultSession;
  llm?: LLMOverride;
}): Promise<ConsultMemoryProfile | null> {
  if (!hasSupabaseEnv() || !params.session.summary) return null;

  const previous = await getConsultMemoryProfile({
    ownerId: params.session.ownerId,
    profileId: params.session.memoryProfileId,
  });
  const newItems = extractConsultMemoryItemsFromSession(params.session);
  const fallback = buildFallbackProfile(params.session, previous, newItems);

  try {
    const raw = await getLLM(params.llm).completeJSON<CompactProfileRaw>({
      system: "你是求职战略咨询产品的长期记忆压缩器。只输出合法 JSON，不输出 markdown。",
      messages: [{ role: "user", content: buildCompactPrompt(params.session, previous, newItems) }],
    });
    return await upsertConsultMemoryProfile(
      normalizeCompactProfile(raw, params.session, previous, fallback)
    );
  } catch (error) {
    console.error("Failed to compact consult memory profile", error);
    return upsertConsultMemoryProfile(fallback);
  }
}

export async function rebuildConsultMemoryProfileFromSessions(params: {
  ownerId: string;
  profileId: string;
  sessions: ConsultSession[];
  llm?: LLMOverride;
}): Promise<ConsultMemoryProfile | null> {
  const savedSessions = params.sessions
    .filter(
      (session) =>
        session.ownerId === params.ownerId &&
        session.memoryProfileId === params.profileId &&
        session.memoryEnabled !== false &&
        session.memorySaveStatus === "saved" &&
        !!session.summary
    )
    .sort((left, right) => (left.endedAt || left.updatedAt) - (right.endedAt || right.updatedAt));

  if (!savedSessions.length) {
    await deleteConsultMemoryProfile({ ownerId: params.ownerId, profileId: params.profileId });
    return null;
  }

  let profile: ConsultMemoryProfile | null = null;
  for (const session of buildMemoryContributionSessions(savedSessions)) {
    const items = extractConsultMemoryItemsFromSession(session);
    const fallback = buildFallbackProfile(session, profile, items);
    try {
      const raw = await getLLM(params.llm).completeJSON<CompactProfileRaw>({
        system: "你是求职战略咨询产品的长期记忆压缩器。只输出合法 JSON，不输出 markdown。",
        messages: [{ role: "user", content: buildCompactPrompt(session, profile, items) }],
      });
      profile = normalizeCompactProfile(raw, session, profile, fallback);
    } catch {
      profile = fallback;
    }
  }

  return profile ? upsertConsultMemoryProfile(profile) : null;
}

export async function deleteConsultMemoryProfile(params: {
  ownerId: string;
  profileId: string;
}): Promise<void> {
  if (!hasSupabaseEnv()) return;

  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from(MEMORY_PROFILE_TABLE)
      .delete()
      .eq("owner_id", params.ownerId)
      .eq("profile_id", params.profileId);
    if (error && !isMissingProfileTableError(error.message)) throw error;
  } catch (error) {
    if (!isMissingProfileTableError(error instanceof Error ? error.message : String(error))) {
      throw error;
    }
  }
}

function buildCompactPrompt(
  session: ConsultSession,
  previous: ConsultMemoryProfile | null,
  newItems: ConsultMemoryItemDraft[]
): string {
  return `请把“旧长期记忆”和“本次新咨询”合并为一份 compact memory。

目标：
- 保留稳定事实、长期短板、当前主攻方向和下一阶段训练重点。
- 如果新咨询推翻旧判断，要写在 recentShift，不要并列堆旧方向。
- 不要复制报告长段落；每条尽量短，像给下一次 AI 咨询看的工作笔记。
- 不要为了求全保留所有信息。优先保留会影响下一次咨询判断的信息。

只输出 JSON：
{
  "compactSummary": "120-220字长期画像摘要",
  "currentTarget": "当前最建议主攻方向或 null",
  "avoidTargets": ["暂不建议方向，最多4条"],
  "stableStrengths": ["稳定优势，最多5条"],
  "recurringIssues": ["反复问题，最多6条"],
  "resolvedIssues": ["已明显缓解或不再优先的问题，最多5条"],
  "practiceFocus": ["下一阶段训练重点，最多6条"],
  "recentShift": "本次相对旧记忆的关键变化或 null",
  "evidenceRefs": ["证据来源短句，最多8条"]
}

【旧长期记忆】
${previous ? formatProfileForPrompt(previous) : "暂无旧 compact memory。"}

【本次咨询结论】
总体判断：${session.summary?.currentJudgement || ""}
主攻方向：${session.summary?.primaryTarget || ""}
暂不建议：${(session.summary?.notRecommended || []).join("；") || "无"}
反复问题：${(session.summary?.repeatedIssues || []).join("；") || "无"}
训练重点：${(session.summary?.nextPracticeFocus || []).join("；") || "无"}
7天计划：${(session.summary?.sevenDayPlan || []).join("；") || "无"}

【本次所选面试】
${session.records.map((record) => `${record.company} · ${record.jobTitle}，分数 ${record.report.overallBand ?? "未知"}/9`).join("\n")}

【本次结构化记忆条目】
${newItems
  .slice(0, 28)
  .map((item) => `- ${item.tags[0] || item.type}: ${item.content}`)
  .join("\n")}`;
}

function formatProfileForPrompt(profile: ConsultMemoryProfile): string {
  return [
    `摘要：${profile.compactSummary}`,
    `当前主攻：${profile.currentTarget || "无"}`,
    `暂不建议：${profile.avoidTargets.join("；") || "无"}`,
    `稳定优势：${profile.stableStrengths.join("；") || "无"}`,
    `反复问题：${profile.recurringIssues.join("；") || "无"}`,
    `已缓解问题：${profile.resolvedIssues.join("；") || "无"}`,
    `训练重点：${profile.practiceFocus.join("；") || "无"}`,
    `最近变化：${profile.recentShift || "无"}`,
  ].join("\n");
}

function normalizeCompactProfile(
  raw: CompactProfileRaw,
  session: ConsultSession,
  previous: ConsultMemoryProfile | null,
  fallback: ConsultMemoryProfile
): ConsultMemoryProfile {
  return {
    ownerId: session.ownerId,
    profileId: session.memoryProfileId,
    version: MEMORY_PROFILE_VERSION,
    compactSummary: cleanText(raw.compactSummary, fallback.compactSummary, 360),
    currentTarget: cleanNullableText(raw.currentTarget, fallback.currentTarget, 120),
    avoidTargets: cleanTextArray(raw.avoidTargets, fallback.avoidTargets, 4, 120),
    stableStrengths: cleanTextArray(raw.stableStrengths, fallback.stableStrengths, 5, 140),
    recurringIssues: cleanTextArray(raw.recurringIssues, fallback.recurringIssues, 6, 150),
    resolvedIssues: cleanTextArray(raw.resolvedIssues, fallback.resolvedIssues, 5, 140),
    practiceFocus: cleanTextArray(raw.practiceFocus, fallback.practiceFocus, 6, 150),
    recentShift: cleanNullableText(raw.recentShift, fallback.recentShift, 160),
    evidenceRefs: cleanTextArray(raw.evidenceRefs, fallback.evidenceRefs, 8, 140),
    sourceSessionCount: Math.max((previous?.sourceSessionCount || 0) + 1, fallback.sourceSessionCount),
    lastCompactedSessionId: session.id,
    updatedAt: Date.now(),
  };
}

function buildFallbackProfile(
  session: ConsultSession,
  previous: ConsultMemoryProfile | null,
  newItems: ConsultMemoryItemDraft[]
): ConsultMemoryProfile {
  const summary = session.summary;
  const recurringIssues = uniqueTexts(
    [
      ...(summary?.repeatedIssues || []),
      ...(previous?.recurringIssues || []),
      ...newItems.filter((item) => item.tags.includes("repeated_issue")).map((item) => item.content),
    ],
    6
  );
  const practiceFocus = uniqueTexts(
    [
      ...(summary?.nextPracticeFocus || []),
      ...(summary?.sevenDayPlan || []),
      ...(previous?.practiceFocus || []),
    ],
    6
  );
  const avoidTargets = uniqueTexts([...(summary?.notRecommended || []), ...(previous?.avoidTargets || [])], 4);
  const currentTarget = summary?.primaryTarget || previous?.currentTarget || null;
  const compactSummary = cleanText(
    summary?.currentJudgement ||
      previous?.compactSummary ||
      "用户已有历史战略咨询记忆，后续咨询应结合主攻方向、反复问题和训练重点推进。",
    "用户已有历史战略咨询记忆，后续咨询应结合主攻方向、反复问题和训练重点推进。",
    360
  );

  return {
    ownerId: session.ownerId,
    profileId: session.memoryProfileId,
    version: MEMORY_PROFILE_VERSION,
    compactSummary,
    currentTarget,
    avoidTargets,
    stableStrengths: previous?.stableStrengths || [],
    recurringIssues,
    resolvedIssues: previous?.resolvedIssues || [],
    practiceFocus,
    recentShift: previous?.currentTarget && currentTarget && previous.currentTarget !== currentTarget
      ? `主攻方向从「${previous.currentTarget}」更新为「${currentTarget}」。`
      : null,
    evidenceRefs: uniqueTexts(
      [
        ...session.records.map((record) => `${record.company} · ${record.jobTitle}`),
        ...(previous?.evidenceRefs || []),
      ],
      8
    ),
    sourceSessionCount: (previous?.sourceSessionCount || 0) + 1,
    lastCompactedSessionId: session.id,
    updatedAt: Date.now(),
  };
}

async function upsertConsultMemoryProfile(profile: ConsultMemoryProfile): Promise<ConsultMemoryProfile | null> {
  if (!hasSupabaseEnv()) return profile;

  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from(MEMORY_PROFILE_TABLE).upsert(
      {
        owner_id: profile.ownerId,
        profile_id: profile.profileId,
        version: profile.version,
        compact_summary: profile.compactSummary,
        current_target: profile.currentTarget,
        avoid_targets: profile.avoidTargets,
        stable_strengths: profile.stableStrengths,
        recurring_issues: profile.recurringIssues,
        resolved_issues: profile.resolvedIssues,
        practice_focus: profile.practiceFocus,
        recent_shift: profile.recentShift,
        evidence_refs: profile.evidenceRefs,
        source_session_count: profile.sourceSessionCount,
        last_compacted_session_id: profile.lastCompactedSessionId,
        updated_at: new Date(profile.updatedAt).toISOString(),
      },
      { onConflict: "owner_id,profile_id" }
    );
    if (error) {
      if (isMissingProfileTableError(error.message)) return null;
      throw error;
    }
    return profile;
  } catch (error) {
    if (isMissingProfileTableError(error instanceof Error ? error.message : String(error))) {
      return null;
    }
    throw error;
  }
}

function rowToMemoryProfile(row: Record<string, unknown>): ConsultMemoryProfile {
  return {
    ownerId: row.owner_id as string,
    profileId: row.profile_id as string,
    version: Number(row.version ?? MEMORY_PROFILE_VERSION),
    compactSummary: (row.compact_summary as string) || "",
    currentTarget: (row.current_target as string | null) ?? null,
    avoidTargets: Array.isArray(row.avoid_targets) ? (row.avoid_targets as string[]) : [],
    stableStrengths: Array.isArray(row.stable_strengths) ? (row.stable_strengths as string[]) : [],
    recurringIssues: Array.isArray(row.recurring_issues) ? (row.recurring_issues as string[]) : [],
    resolvedIssues: Array.isArray(row.resolved_issues) ? (row.resolved_issues as string[]) : [],
    practiceFocus: Array.isArray(row.practice_focus) ? (row.practice_focus as string[]) : [],
    recentShift: (row.recent_shift as string | null) ?? null,
    evidenceRefs: Array.isArray(row.evidence_refs) ? (row.evidence_refs as string[]) : [],
    sourceSessionCount: Number(row.source_session_count ?? 0),
    lastCompactedSessionId: (row.last_compacted_session_id as string | null) ?? null,
    updatedAt: row.updated_at ? new Date(row.updated_at as string).getTime() : Date.now(),
  };
}

function cleanText(value: unknown, fallback: string, limit: number): string {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return (text || fallback).slice(0, limit);
}

function cleanNullableText(value: unknown, fallback: string | null, limit: number): string | null {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (text) return text.slice(0, limit);
  return fallback ? fallback.slice(0, limit) : null;
}

function cleanTextArray(value: unknown, fallback: string[], limit: number, itemLimit: number): string[] {
  const array = Array.isArray(value) ? value : fallback;
  return uniqueTexts(
    array
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.replace(/\s+/g, " ").trim().slice(0, itemLimit)),
    limit
  );
}

function uniqueTexts(items: string[], limit: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const normalized = item.replace(/[，。！？；、\s"'""''\-—_]/g, "");
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(item);
    if (result.length >= limit) break;
  }
  return result;
}

function hasSupabaseEnv(): boolean {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function isMissingProfileTableError(message: string): boolean {
  return (
    message.includes(MEMORY_PROFILE_TABLE) ||
    message.includes("Could not find the table") ||
    message.includes("does not exist")
  );
}
