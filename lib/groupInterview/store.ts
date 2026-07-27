import { randomUUID } from "crypto";
import { getSupabaseClient } from "@/lib/supabase";
import type { VoiceSettings } from "@/lib/voice/types";
import {
  DEFAULT_GROUP_DURATIONS,
  type GroupDurations,
  type GroupInterviewSession,
  type GroupMember,
  type GroupReport,
  type GroupTopic,
  type GroupTurn,
} from "./types";
import { DEFAULT_VOICE_SETTINGS } from "@/lib/voice/types";

const TABLE = "group_interview_sessions";

export async function createGroupSession(
  data: Omit<GroupInterviewSession, "id" | "createdAt">
): Promise<GroupInterviewSession> {
  const supabase = getSupabaseClient();
  const now = Date.now();
  const session: GroupInterviewSession = {
    ...data,
    id: randomUUID(),
    createdAt: now,
  };

  const { error } = await supabase.from(TABLE).insert({
    id: session.id,
    owner_id: session.ownerId,
    resume: session.resume,
    company: session.company,
    job_title: session.jobTitle,
    jd: session.jd,
    language: session.language,
    difficulty: session.difficulty,
    durations: session.durations,
    provider: session.provider,
    model: session.model,
    thinking_enabled: session.thinkingEnabled,
    voice: session.voice,
    topic: session.topic,
    members: session.members,
    phase: session.phase,
    transcript: session.transcript,
    reporter_id: session.reporterId,
    reporter_kind: session.reporterKind,
    status: session.status,
    report: session.report,
    created_at: new Date(session.createdAt).toISOString(),
  });

  if (error) throw new Error(`Failed to create group session: ${error.message}`);
  return session;
}

export async function getGroupSession(
  id: string,
  ownerId?: string
): Promise<GroupInterviewSession | undefined> {
  const supabase = getSupabaseClient();
  let query = supabase.from(TABLE).select("*").eq("id", id).is("deleted_at", null);
  if (ownerId) query = query.eq("owner_id", ownerId);
  const { data, error } = await query.single();
  if (error || !data) return undefined;
  return rowToGroupSession(data);
}

export async function updateGroupSession(
  id: string,
  patch: Partial<GroupInterviewSession>,
  ownerId?: string
): Promise<GroupInterviewSession | undefined> {
  const supabase = getSupabaseClient();
  const dbPatch: Record<string, unknown> = {};

  if (patch.phase !== undefined) dbPatch.phase = patch.phase;
  if (patch.transcript !== undefined) dbPatch.transcript = patch.transcript;
  if (patch.reporterId !== undefined) dbPatch.reporter_id = patch.reporterId;
  if (patch.reporterKind !== undefined) dbPatch.reporter_kind = patch.reporterKind;
  if (patch.status !== undefined) dbPatch.status = patch.status;
  if (patch.report !== undefined) dbPatch.report = patch.report;

  if (Object.keys(dbPatch).length === 0) {
    return getGroupSession(id, ownerId);
  }

  let query = supabase.from(TABLE).update(dbPatch).eq("id", id).is("deleted_at", null);
  if (ownerId) query = query.eq("owner_id", ownerId);
  const { data, error } = await query.select("*").single();
  if (error || !data) return undefined;
  return rowToGroupSession(data);
}

export type GroupSessionListItem = {
  id: string;
  company: string;
  jobTitle: string;
  topicTitle: string;
  phase: GroupInterviewSession["phase"];
  status: GroupInterviewSession["status"];
  hasReport: boolean;
  overallScore: number | null;
  createdAt: number;
};

export async function listGroupSessions(ownerId: string, limit?: number): Promise<GroupSessionListItem[]> {
  const supabase = getSupabaseClient();
  let query = supabase
    .from(TABLE)
    .select("id, company, job_title, topic, phase, status, report, created_at")
    .eq("owner_id", ownerId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (typeof limit === "number" && limit > 0) query = query.limit(limit);
  const { data, error } = await query;

  if (error || !data) return [];
  return data.map((row: Record<string, unknown>) => {
    const topic = (row.topic as GroupTopic | null) || null;
    const report = (row.report as GroupReport | null) || null;
    return {
      id: row.id as string,
      company: (row.company as string) || "",
      jobTitle: (row.job_title as string) || "",
      topicTitle: topic?.title || "",
      phase: row.phase as GroupInterviewSession["phase"],
      status: row.status as GroupInterviewSession["status"],
      hasReport: Boolean(report),
      overallScore: report?.personal?.overallScore ?? null,
      createdAt: new Date(row.created_at as string).getTime(),
    };
  });
}

export async function softDeleteGroupSession(id: string, ownerId: string): Promise<boolean> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from(TABLE)
    .update({ deleted_at: new Date().toISOString(), deleted_by: ownerId })
    .eq("id", id)
    .eq("owner_id", ownerId)
    .is("deleted_at", null);
  return !error;
}

function rowToGroupSession(row: Record<string, unknown>): GroupInterviewSession {
  return {
    id: row.id as string,
    ownerId: (row.owner_id as string) || "",
    resume: (row.resume as string) || "",
    company: (row.company as string) || "",
    jobTitle: (row.job_title as string) || "",
    jd: (row.jd as string) || "",
    language: row.language as GroupInterviewSession["language"],
    difficulty: row.difficulty as GroupInterviewSession["difficulty"],
    durations: { ...DEFAULT_GROUP_DURATIONS, ...((row.durations as Partial<GroupDurations>) || {}) },
    provider: (row.provider as string) || "",
    model: (row.model as string) || "",
    thinkingEnabled: (row.thinking_enabled as boolean) || false,
    voice: { ...DEFAULT_VOICE_SETTINGS, ...((row.voice as Partial<VoiceSettings>) || {}) },
    topic: (row.topic as GroupTopic) || ({} as GroupTopic),
    members: (row.members as GroupMember[]) || [],
    phase: row.phase as GroupInterviewSession["phase"],
    transcript: (row.transcript as GroupTurn[]) || [],
    reporterId: (row.reporter_id as string) || null,
    reporterKind: (row.reporter_kind as GroupInterviewSession["reporterKind"]) ?? null,
    status: row.status as GroupInterviewSession["status"],
    report: (row.report as GroupReport) || null,
    createdAt: new Date(row.created_at as string).getTime(),
  };
}
