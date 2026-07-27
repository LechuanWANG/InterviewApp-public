import { getSupabaseClient } from "../supabase";
import type { ConsultSession } from "./types";
import { setCommonIssueMemoryStatusByKey } from "./memoryItems";
import { interviewMemorySourcesForSession } from "./memoryCoverage";

const DEFAULT_PROFILE_ID = "local-default-user";

export type ConsultMemoryIssueSourceType = "consultation" | "interview_report";

export type ConsultMemoryIssue = {
  id: string;
  normalizedKey: string;
  label: string;
  category: "common" | "single";
  sourceTypes: ConsultMemoryIssueSourceType[];
  sourceIds: string[];
  sourceTitles: string[];
  occurrenceCount: number;
  lastSeenAt: number;
  resolved: boolean;
};

export type ConsultMemoryIssuesResult = {
  commonIssues: ConsultMemoryIssue[];
  singleInterviewIssues: ConsultMemoryIssue[];
  resolvedIssues: ConsultMemoryIssue[];
};

type ResolvedIssueRecord = {
  normalizedKey: string;
  label: string;
  resolvedAt: number;
};

export async function buildConsultMemoryIssues(params: {
  sessions: ConsultSession[];
  interviewRecords?: unknown[];
  profileId?: string;
  ownerId?: string;
  recentLimit?: number;
}): Promise<ConsultMemoryIssuesResult> {
  const profileId = params.profileId || DEFAULT_PROFILE_ID;
  const resolvedMap = await getResolvedIssueMap(profileId, params.ownerId);
  const issueMap = new Map<string, ConsultMemoryIssue>();
  const sessions = params.sessions
    .filter(
      (session) =>
        session.memoryProfileId === profileId &&
        session.memoryEnabled !== false &&
        getMemorySaveStatus(session) === "saved" &&
        (session.status === "completed" || !!session.summary)
    )
    .sort((left, right) => (right.endedAt || right.updatedAt) - (left.endedAt || left.updatedAt))
    .slice(0, params.recentLimit ?? 8);

  for (const session of sessions) {
    if (session.summary) {
      const sources = interviewMemorySourcesForSession(session);
      const issueSources = sources.length
        ? sources
        : [{ id: `consultation:${session.id}`, title: consultSourceTitle(session) }];
      for (const issue of session.summary.repeatedIssues) {
        for (const source of issueSources) {
          addIssue(issueMap, issue, {
            sourceType: "consultation",
            sourceId: source.id,
            sourceTitle: source.title,
            seenAt: session.endedAt || session.updatedAt,
            resolved: resolvedMap.has(normalizeIssueKey(issue)),
          });
        }
      }
    }
  }

  const activeIssues = Array.from(issueMap.values()).filter((issue) => {
    if (issue.resolved) {
      return false;
    }
    return true;
  });

  const commonIssues = activeIssues
    .filter((issue) => issue.sourceTypes.includes("consultation"))
    .map((issue) => ({ ...issue, category: "common" as const }))
    .sort(sortIssues);

  const resolvedIssues = Array.from(resolvedMap.values())
    .map((record) => issueMap.get(record.normalizedKey))
    .filter((issue): issue is ConsultMemoryIssue => !!issue)
    .map((issue) => ({ ...issue, resolved: true }))
    .sort(sortIssues);

  return {
    commonIssues,
    singleInterviewIssues: [],
    resolvedIssues,
  };
}

export async function getResolvedIssueKeys(profileId = DEFAULT_PROFILE_ID, ownerId?: string): Promise<Set<string>> {
  const map = await getResolvedIssueMap(profileId, ownerId);
  return new Set(map.keys());
}

export async function markIssueResolved(params: {
  normalizedKey: string;
  label: string;
  profileId?: string;
  ownerId?: string;
}) {
  const profileId = params.profileId || DEFAULT_PROFILE_ID;
  const normalizedKey = normalizeIssueKey(params.normalizedKey || params.label);
  if (!normalizedKey) return;

  const supabase = getSupabaseClient();
  const { error } = await supabase.from("consult_memory_resolutions").upsert({
    normalized_key: normalizedKey,
    profile_id: profileId,
    owner_id: params.ownerId ?? ownerIdFromProfile(profileId),
    label: params.label || params.normalizedKey,
    resolved_at: new Date().toISOString(),
  });

  if (error) throw new Error(`Failed to mark issue resolved: ${error.message}`);
  await setCommonIssueMemoryStatusByKey({
    normalizedKey,
    profileId,
    ownerId: params.ownerId,
    status: "user_removed",
  });
}

export async function restoreIssueToMemory(params: {
  normalizedKey: string;
  profileId?: string;
  ownerId?: string;
}) {
  const profileId = params.profileId || DEFAULT_PROFILE_ID;
  const supabase = getSupabaseClient();
  let query = supabase
    .from("consult_memory_resolutions")
    .delete()
    .eq("normalized_key", params.normalizedKey)
    .eq("profile_id", profileId);
  const ownerId = params.ownerId ?? ownerIdFromProfile(profileId);
  if (ownerId) query = query.eq("owner_id", ownerId);
  const { error } = await query;

  if (error) throw new Error(`Failed to restore issue: ${error.message}`);
  await setCommonIssueMemoryStatusByKey({
    normalizedKey: params.normalizedKey,
    profileId,
    ownerId,
    status: "active",
  });
}

export function normalizeIssueKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[""'"".?？!！,，。；;：:\s、\-—_]/g, "")
    .replace(/^(问题|短板|建议|主要问题|提高建议|下次优先)/, "")
    .slice(0, 80)
    .trim();
}

function addIssue(
  issueMap: Map<string, ConsultMemoryIssue>,
  label: string,
  source: {
    sourceType: ConsultMemoryIssueSourceType;
    sourceId: string;
    sourceTitle: string;
    seenAt: number;
    resolved: boolean;
  }
) {
  const cleaned = cleanIssueLabel(label);
  const normalizedKey = normalizeIssueKey(cleaned);
  if (!cleaned || !normalizedKey) return;

  const existing = issueMap.get(normalizedKey);
  if (!existing) {
    issueMap.set(normalizedKey, {
      id: issueId(normalizedKey),
      normalizedKey,
      label: cleaned,
      category: "single",
      sourceTypes: [source.sourceType],
      sourceIds: [source.sourceId],
      sourceTitles: [source.sourceTitle],
      occurrenceCount: 1,
      lastSeenAt: source.seenAt,
      resolved: source.resolved,
    });
    return;
  }

  const isNewSource = !existing.sourceIds.includes(source.sourceId);
  if (isNewSource) existing.occurrenceCount += 1;
  existing.lastSeenAt = Math.max(existing.lastSeenAt, source.seenAt);
  existing.resolved = existing.resolved || source.resolved;
  if (!existing.sourceTypes.includes(source.sourceType)) existing.sourceTypes.push(source.sourceType);
  if (isNewSource) existing.sourceIds.push(source.sourceId);
  if (!existing.sourceTitles.includes(source.sourceTitle)) existing.sourceTitles.push(source.sourceTitle);
}

function cleanIssueLabel(label: string): string {
  return label.replace(/\s+/g, " ").replace(/^[-•\d.、\s]+/, "").trim();
}

function issueId(normalizedKey: string): string {
  return Buffer.from(normalizedKey).toString("base64url").slice(0, 32);
}

function consultSourceTitle(session: ConsultSession): string {
  if (session.records.length === 1) {
    const record = session.records[0];
    return `${record.jobTitle} · ${record.company}`;
  }
  return `战略咨询 ${session.records.length} 场面试`;
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

function sortIssues(left: ConsultMemoryIssue, right: ConsultMemoryIssue): number {
  return right.occurrenceCount - left.occurrenceCount || right.lastSeenAt - left.lastSeenAt;
}

async function getResolvedIssueMap(profileId: string, ownerId?: string): Promise<Map<string, ResolvedIssueRecord>> {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return new Map();
  }

  const supabase = getSupabaseClient();
  let query = supabase
    .from("consult_memory_resolutions")
    .select("normalized_key, label, resolved_at")
    .eq("profile_id", profileId);
  const resolvedOwnerId = ownerId ?? ownerIdFromProfile(profileId);
  if (resolvedOwnerId) query = query.eq("owner_id", resolvedOwnerId);
  const { data, error } = await query;

  if (error) throw new Error(`Failed to fetch resolved issues: ${error.message}`);

  const map = new Map<string, ResolvedIssueRecord>();
  for (const row of data || []) {
    map.set(row.normalized_key, {
      normalizedKey: row.normalized_key,
      label: row.label,
      resolvedAt: new Date(row.resolved_at).getTime(),
    });
  }
  return map;
}

function ownerIdFromProfile(profileId: string): string | undefined {
  return profileId.startsWith("user:") ? profileId.slice("user:".length) : undefined;
}
