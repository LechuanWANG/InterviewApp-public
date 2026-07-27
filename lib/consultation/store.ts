import { randomUUID } from "crypto";
import { getSupabaseClient } from "../supabase";
import type {
  ConsultGoal,
  ConsultMemorySaveStatus,
  ConsultMessage,
  ConsultSession,
  ConsultSummary,
} from "./types";
import {
  getInterviewRecords,
  type InterviewHistoryRecord,
} from "../historyStore";
import { DEFAULT_CONSULT_PROFILE_ID } from "./memory";
import { compactConsultMemoryProfile } from "./memoryProfile";
import { updateConsultMemoryGraphFromSession } from "./memoryGraph";
import { syncConsultSessionMemoryItems } from "./memoryItems";
import { buildMemoryContributionSession } from "./memoryCoverage";
import { findModel, DEFAULT_MODEL_ID } from "../llm/models";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function createConsultSession(params: {
  ownerId: string;
  records: InterviewHistoryRecord[];
  goal: ConsultGoal;
  firstMessage: string;
  memoryProfileId?: string;
  memoryEnabled?: boolean;
  provider?: string;
  model?: string;
}): Promise<ConsultSession> {
  const supabase = getSupabaseClient();
  const now = Date.now();
  const defaultModel = findModel(DEFAULT_MODEL_ID);
  const sessionId = randomUUID();
  const firstMessageId = randomUUID();

  const session: ConsultSession = {
    id: sessionId,
    ownerId: params.ownerId,
    selectedInterviewSessionIds: params.records.map((record) => record.id),
    summaryMode: params.records.length === 1 ? "single_session" : "multi_session",
    goal: params.goal,
    mentorType: "career_strategist",
    memoryProfileId: params.memoryProfileId || `user:${params.ownerId}` || DEFAULT_CONSULT_PROFILE_ID,
    memoryEnabled: params.memoryEnabled ?? true,
    memorySaveStatus: params.memoryEnabled === false ? "excluded" : "saved",
    provider: params.provider || defaultModel.provider,
    model: params.model || defaultModel.model,
    status: "active",
    endedBy: null,
    records: params.records,
    messages: [
      {
        id: firstMessageId,
        ownerId: params.ownerId,
        role: "assistant",
        content: params.firstMessage,
        createdAt: now,
      },
    ],
    summary: null,
    createdAt: now,
    updatedAt: now,
  };

  const { error: sessionError } = await supabase.from("consult_sessions").insert({
    id: session.id,
    owner_id: session.ownerId,
    selected_interview_session_ids: session.selectedInterviewSessionIds,
    summary_mode: session.summaryMode,
    goal: session.goal,
    mentor_type: session.mentorType,
    memory_profile_id: session.memoryProfileId,
    memory_enabled: session.memoryEnabled,
    memory_save_status: session.memorySaveStatus,
    provider: session.provider,
    model: session.model,
    status: session.status,
    ended_by: session.endedBy,
    records: session.records,
    summary: session.summary,
    created_at: new Date(session.createdAt).toISOString(),
    updated_at: new Date(session.updatedAt).toISOString(),
  });

  if (sessionError) throw new Error(`Failed to create consult session: ${sessionError.message}`);

  const { error: msgError } = await supabase.from("consult_messages").insert({
    id: firstMessageId,
    owner_id: params.ownerId,
    session_id: sessionId,
    role: "assistant",
    content: params.firstMessage,
    created_at: new Date(now).toISOString(),
  });

  if (msgError) throw new Error(`Failed to create consult message: ${msgError.message}`);

  return session;
}

export async function getConsultSession(id: string, ownerId?: string): Promise<ConsultSession | undefined> {
  const supabase = getSupabaseClient();
  let sessionQuery = supabase
    .from("consult_sessions")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null);
  if (ownerId) sessionQuery = sessionQuery.eq("owner_id", ownerId);
  const { data: sessionRow, error } = await sessionQuery.single();

  if (error || !sessionRow) return undefined;

  let messageQuery = supabase
    .from("consult_messages")
    .select("*")
    .eq("session_id", id)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (ownerId) messageQuery = messageQuery.eq("owner_id", ownerId);
  const { data: messageRows, error: msgError } = await messageQuery;

  if (msgError) throw new Error(`Failed to fetch messages: ${msgError.message}`);

  return filterDeletedInterviewRecordsForSession(rowToSession(sessionRow, messageRows || []));
}

export async function listConsultSessions(ownerId?: string): Promise<ConsultSession[]> {
  const supabase = getSupabaseClient();
  let sessionQuery = supabase
    .from("consult_sessions")
    .select("*")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (ownerId) sessionQuery = sessionQuery.eq("owner_id", ownerId);
  const { data: sessionRows, error } = await sessionQuery;

  if (error) throw new Error(`Failed to list consult sessions: ${error.message}`);
  if (!sessionRows || sessionRows.length === 0) return [];

  const sessionIds = sessionRows.map((row) => row.id as string);
  let messageQuery = supabase
    .from("consult_messages")
    .select("*")
    .in("session_id", sessionIds)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (ownerId) messageQuery = messageQuery.eq("owner_id", ownerId);
  const { data: messageRows, error: msgError } = await messageQuery;

  if (msgError) throw new Error(`Failed to fetch messages: ${msgError.message}`);

  const messagesBySession = new Map<string, Record<string, unknown>[]>();
  for (const msg of messageRows || []) {
    const sid = msg.session_id as string;
    if (!messagesBySession.has(sid)) messagesBySession.set(sid, []);
    messagesBySession.get(sid)!.push(msg);
  }

  return filterDeletedInterviewRecordsForSessions(
    sessionRows.map((row) => rowToSession(row, messagesBySession.get(row.id as string) || [])),
    ownerId
  );
}

export async function appendConsultMessage(
  id: string,
  role: ConsultMessage["role"],
  content: string,
  ownerId?: string
): Promise<ConsultMessage | null> {
  const supabase = getSupabaseClient();
  let activeSessionQuery = supabase
    .from("consult_sessions")
    .select("id")
    .eq("id", id)
    .is("deleted_at", null)
    .limit(1);
  if (ownerId) activeSessionQuery = activeSessionQuery.eq("owner_id", ownerId);
  const { data: activeSession, error: activeSessionError } = await activeSessionQuery.maybeSingle();
  if (activeSessionError) throw new Error(`Failed to verify consult session: ${activeSessionError.message}`);
  if (!activeSession) throw new Error("consult session not found");

  const message: ConsultMessage = {
    id: randomUUID(),
    ownerId,
    role,
    content,
    createdAt: Date.now(),
  };

  const { error: msgError } = await supabase.from("consult_messages").insert({
    id: message.id,
    owner_id: ownerId,
    session_id: id,
    role: message.role,
    content: message.content,
    created_at: new Date(message.createdAt).toISOString(),
  });

  if (msgError) throw new Error(`Failed to append message: ${msgError.message}`);

  let updateQuery = supabase
    .from("consult_sessions")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null);
  if (ownerId) updateQuery = updateQuery.eq("owner_id", ownerId);
  const { error: updateError } = await updateQuery;

  if (updateError) throw new Error(`Failed to update session timestamp: ${updateError.message}`);

  return message;
}

export async function completeConsultSession(
  id: string,
  summary: ConsultSummary,
  endedBy: NonNullable<ConsultSession["endedBy"]>,
  ownerId?: string
): Promise<ConsultSession | undefined> {
  const supabase = getSupabaseClient();
  const now = new Date().toISOString();

  let query = supabase
    .from("consult_sessions")
    .update({
      summary,
      status: "completed",
      ended_by: endedBy,
      ended_at: now,
      updated_at: now,
    })
    .eq("id", id)
    .is("deleted_at", null);
  if (ownerId) query = query.eq("owner_id", ownerId);
  const { error } = await query;

  if (error) throw new Error(`Failed to complete consult session: ${error.message}`);
  const completed = await getConsultSession(id, ownerId);
  if (completed && completed.memoryEnabled !== false && completed.memorySaveStatus === "saved") {
    try {
      const memorySession = buildMemoryContributionSession(
        completed,
        await listConsultSessions(completed.ownerId)
      );
      if (!memorySession) return completed;
      await syncConsultSessionMemoryItems(memorySession);
      await compactConsultMemoryProfile({
        session: memorySession,
        llm: { provider: completed.provider, model: completed.model },
      });
      await updateConsultMemoryGraphFromSession({
        session: memorySession,
        llm: { provider: completed.provider, model: completed.model },
      });
    } catch (memoryError) {
      console.error("Failed to sync consult memory items", memoryError);
    }
  }
  return completed;
}

export async function reopenConsultSession(id: string, ownerId?: string): Promise<ConsultSession | undefined> {
  const supabase = getSupabaseClient();
  let query = supabase
    .from("consult_sessions")
    .update({
      status: "active",
      ended_by: null,
      ended_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .is("deleted_at", null);
  if (ownerId) query = query.eq("owner_id", ownerId);
  const { error } = await query;

  if (error) throw new Error(`Failed to reopen consult session: ${error.message}`);
  return getConsultSession(id, ownerId);
}

export async function deleteConsultSession(id: string, ownerId?: string): Promise<boolean> {
  const supabase = getSupabaseClient();
  const deletedAt = new Date().toISOString();
  let messageQuery = supabase
    .from("consult_messages")
    .update({
      deleted_at: deletedAt,
      deleted_by: ownerId || null,
      delete_reason: "user_deleted",
    })
    .eq("session_id", id)
    .is("deleted_at", null);
  if (ownerId) messageQuery = messageQuery.eq("owner_id", ownerId);
  const { data: messageRows, error: messageError } = await messageQuery.select("id");

  if (messageError) throw new Error(`Failed to delete consult messages: ${messageError.message}`);

  let sessionDeleteQuery = supabase
    .from("consult_sessions")
    .update({
      deleted_at: deletedAt,
      deleted_by: ownerId || null,
      delete_reason: "user_deleted",
    })
    .eq("id", id)
    .is("deleted_at", null);
  if (ownerId) sessionDeleteQuery = sessionDeleteQuery.eq("owner_id", ownerId);
  const { error, data: sessionRows } = await sessionDeleteQuery.select("id");

  if (error) throw new Error(`Failed to delete consult session: ${error.message}`);
  let ratingQuery = supabase
    .from("consult_experience_ratings")
    .update({
      deleted_at: deletedAt,
      deleted_by: ownerId || null,
      delete_reason: "user_deleted",
    })
    .eq("consult_session_id", id)
    .is("deleted_at", null);
  if (ownerId) ratingQuery = ratingQuery.eq("owner_id", ownerId);
  const { data: ratingRows, error: ratingError } = await ratingQuery.select("id");

  if (ratingError) throw new Error(`Failed to delete consult rating: ${ratingError.message}`);
  return ((sessionRows?.length ?? 0) + (messageRows?.length ?? 0) + (ratingRows?.length ?? 0)) > 0;
}

function rowToSession(
  row: Record<string, unknown>,
  messageRows: Record<string, unknown>[]
): ConsultSession {
  return {
    id: row.id as string,
    ownerId: (row.owner_id as string) || "",
    selectedInterviewSessionIds: (row.selected_interview_session_ids as string[]) || [],
    summaryMode: row.summary_mode as ConsultSession["summaryMode"],
    goal: row.goal as ConsultSession["goal"],
    // 人格已统一为资深战略咨询顾问；旧行里的 mentor_type 一律按新人格处理。
    mentorType: "career_strategist",
    memoryProfileId: (row.memory_profile_id as string) || DEFAULT_CONSULT_PROFILE_ID,
    memoryEnabled: (row.memory_enabled as boolean) ?? true,
    memorySaveStatus: (row.memory_save_status as ConsultMemorySaveStatus) || "pending",
    provider: row.provider as string,
    model: row.model as string,
    status: row.status as ConsultSession["status"],
    endedBy: (row.ended_by as ConsultSession["endedBy"]) || null,
    records: (row.records as InterviewHistoryRecord[]) || [],
    messages: messageRows.map((msg) => ({
      id: msg.id as string,
      ownerId: (msg.owner_id as string) || "",
      role: msg.role as "user" | "assistant",
      content: msg.content as string,
      createdAt: new Date(msg.created_at as string).getTime(),
    })),
    summary: (row.summary as ConsultSummary) || null,
    createdAt: new Date(row.created_at as string).getTime(),
    updatedAt: new Date(row.updated_at as string).getTime(),
    endedAt: row.ended_at ? new Date(row.ended_at as string).getTime() : undefined,
  };
}

async function filterDeletedInterviewRecordsForSession(session: ConsultSession): Promise<ConsultSession> {
  const records = await activeInterviewRecordsFromEmbeddedRecords(session.records, session.ownerId);
  return {
    ...session,
    records,
    selectedInterviewSessionIds: records.map((record) => record.id),
  };
}

async function filterDeletedInterviewRecordsForSessions(
  sessions: ConsultSession[],
  ownerId?: string
): Promise<ConsultSession[]> {
  const allKeys = uniqueStrings(
    sessions.flatMap((session) =>
      session.records.flatMap((record) => [record.id, record.sessionId])
    )
  );
  if (!allKeys.length) {
    return sessions.map((session) => ({
      ...session,
      records: [],
      selectedInterviewSessionIds: [],
    }));
  }

  const records = await getInterviewRecords(allKeys, ownerId);
  const activeKeys = new Set(
    records.flatMap((record) => [record.id, record.sessionId].filter(Boolean))
  );

  return sessions.map((session) => {
    const nextRecords = session.records.filter((record) =>
      activeKeys.has(record.id) || activeKeys.has(record.sessionId)
    );
    return {
      ...session,
      records: nextRecords,
      selectedInterviewSessionIds: nextRecords.map((record) => record.id),
    };
  });
}

async function activeInterviewRecordsFromEmbeddedRecords(
  records: InterviewHistoryRecord[],
  ownerId: string
): Promise<InterviewHistoryRecord[]> {
  const keys = uniqueStrings(records.flatMap((record) => [record.id, record.sessionId]));
  if (!keys.length) return [];
  const activeRecords = await getInterviewRecords(keys, ownerId);
  const activeByKey = new Map<string, InterviewHistoryRecord>();
  for (const record of activeRecords) {
    activeByKey.set(record.id, record);
    activeByKey.set(record.sessionId, record);
  }
  return records
    .map((record) => activeByKey.get(record.id) || activeByKey.get(record.sessionId))
    .filter(Boolean) as InterviewHistoryRecord[];
}

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  return Array.from(new Set(values.map((value) => value?.trim()).filter(Boolean) as string[]));
}
