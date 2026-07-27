import { getSupabaseClient } from "./supabase";
import type { Report, Round, Session } from "./types";

export type InterviewHistoryRecord = {
  id: string;
  ownerId: string;
  sessionId: string;
  resume: string;
  company: string;
  jobTitle: string;
  jd: string;
  interviewType: Session["interviewType"];
  language: Session["language"];
  persona: Session["persona"];
  difficulty: Session["difficulty"];
  mode: Session["mode"];
  rounds: Round[];
  report: Report;
  createdAt: number;
  reportedAt: number;
  /** 记录来源形式；一对一为 undefined/"one_on_one"，群面记录为 "group"。 */
  format?: "one_on_one" | "group";
};

export async function saveInterviewRecord(session: Session): Promise<InterviewHistoryRecord | null> {
  if (!session.report) return null;

  const supabase = getSupabaseClient();
  const existing = await findExistingHistoryRecord(supabase, session.id, session.ownerId);
  const recordId = existing?.id || session.id;
  const reportedAt = existing?.reportedAt || Date.now();

  const record: InterviewHistoryRecord = {
    id: recordId,
    ownerId: session.ownerId,
    sessionId: session.id,
    resume: session.resume,
    company: session.company,
    jobTitle: session.jobTitle,
    jd: session.jd,
    interviewType: session.interviewType,
    language: session.language,
    persona: session.persona,
    difficulty: session.difficulty,
    mode: session.mode,
    rounds: session.rounds,
    report: session.report,
    createdAt: session.createdAt,
    reportedAt,
  };

  const { error } = await supabase.from("interview_history").upsert({
    id: record.id,
    owner_id: record.ownerId,
    session_id: record.sessionId,
    resume: record.resume,
    company: record.company,
    job_title: record.jobTitle,
    jd: record.jd,
    interview_type: record.interviewType,
    language: record.language,
    persona: record.persona,
    difficulty: record.difficulty,
    mode: record.mode,
    rounds: record.rounds,
    report: record.report,
    created_at: new Date(record.createdAt).toISOString(),
    reported_at: new Date(record.reportedAt).toISOString(),
    deleted_at: null,
    deleted_by: null,
    delete_reason: null,
  }, { onConflict: "id" });

  if (error) throw new Error(`Failed to save interview record: ${error.message}`);
  return record;
}

export async function listInterviewRecords(ownerId?: string, limit?: number): Promise<InterviewHistoryRecord[]> {
  const supabase = getSupabaseClient();
  let query = supabase
    .from("interview_history")
    .select("*")
    .is("deleted_at", null)
    .order("reported_at", { ascending: false });
  if (ownerId) query = query.eq("owner_id", ownerId);
  if (typeof limit === "number" && limit > 0) query = query.limit(limit);
  const { data, error } = await query;

  if (error) throw new Error(`Failed to list interview records: ${error.message}`);
  return (data || []).map(rowToRecord);
}

export async function getInterviewRecordById(id: string, ownerId?: string): Promise<InterviewHistoryRecord | null> {
  const supabase = getSupabaseClient();
  let query = supabase
    .from("interview_history")
    .select("*")
    .or(`id.eq.${id},session_id.eq.${id}`)
    .is("deleted_at", null)
    .limit(1);
  if (ownerId) query = query.eq("owner_id", ownerId);
  const { data, error } = await query.single();

  if (error || !data) return null;
  return rowToRecord(data);
}

export async function getInterviewRecords(ids: string[], ownerId?: string): Promise<InterviewHistoryRecord[]> {
  const lookupIds = uniqueStrings(ids);
  if (!lookupIds.length) return [];
  const supabase = getSupabaseClient();
  const byId = await queryHistoryRecordRowsByColumn(supabase, "id", lookupIds, ownerId);
  const bySessionId = await queryHistoryRecordRowsByColumn(supabase, "session_id", lookupIds, ownerId);

  const deduped = new Map<string, Record<string, unknown>>();
  for (const row of [...byId, ...bySessionId]) {
    deduped.set(row.id as string, row);
  }

  return Array.from(deduped.values())
    .sort((a, b) => {
      const left = new Date(a.reported_at as string).getTime();
      const right = new Date(b.reported_at as string).getTime();
      return right - left;
    })
    .map(rowToRecord);
}

export type DeleteInterviewRecordResult = {
  ok: boolean;
  deleted: boolean;
  softDeleted: boolean;
  historyDeleted: number;
  sessionsDeleted: number;
  ratingsDeleted: number;
  matchedBefore: number;
  remaining: number;
  remainingSessions: number;
};

export async function deleteInterviewRecord(
  id: string,
  sessionId?: string,
  ownerId?: string
): Promise<DeleteInterviewRecordResult> {
  const supabase = getSupabaseClient();
  const candidateIds = uniqueStrings([id, sessionId]);
  const matchedRows = await findHistoryRows(supabase, candidateIds, ownerId);
  const matchedHistoryIds = uniqueStrings(matchedRows.map((row) => row.id));
  const matchedSessionIds = uniqueStrings(matchedRows.map((row) => row.sessionId));
  const sessionIdsToDelete = uniqueStrings([...candidateIds, ...matchedSessionIds]);
  const sessionUuidsToDelete = sessionIdsToDelete.filter(isUUID);
  const deletedAt = new Date().toISOString();

  let historyDeleted = 0;
  if (matchedHistoryIds.length) {
    let deleteQuery = supabase
      .from("interview_history")
      .update({
        deleted_at: deletedAt,
        deleted_by: ownerId || null,
        delete_reason: "user_deleted",
      })
      .is("deleted_at", null)
      .in("id", matchedHistoryIds);
    if (ownerId) deleteQuery = deleteQuery.eq("owner_id", ownerId);
    const { data, error } = await deleteQuery.select("id");

    if (error) throw new Error(`Failed to delete interview record: ${error.message}`);
    historyDeleted += data?.length ?? 0;
  }

  if (sessionIdsToDelete.length) {
    let deleteQuery = supabase
      .from("interview_history")
      .update({
        deleted_at: deletedAt,
        deleted_by: ownerId || null,
        delete_reason: "user_deleted",
      })
      .is("deleted_at", null)
      .in("session_id", sessionIdsToDelete);
    if (ownerId) deleteQuery = deleteQuery.eq("owner_id", ownerId);
    const { data, error } = await deleteQuery.select("id");

    if (error) throw new Error(`Failed to delete interview records by session: ${error.message}`);
    historyDeleted += data?.length ?? 0;
  }

  let sessionsDeleted = 0;
  if (sessionUuidsToDelete.length) {
    let deleteQuery = supabase
      .from("interview_sessions")
      .update({
        deleted_at: deletedAt,
        deleted_by: ownerId || null,
        delete_reason: "user_deleted",
      })
      .is("deleted_at", null)
      .in("id", sessionUuidsToDelete);
    if (ownerId) deleteQuery = deleteQuery.eq("owner_id", ownerId);
    const { data, error } = await deleteQuery.select("id");

    if (error) throw new Error(`Failed to delete interview session: ${error.message}`);
    sessionsDeleted = data?.length ?? 0;
  }

  let ratingsDeleted = 0;
  if (sessionUuidsToDelete.length) {
    let deleteQuery = supabase
      .from("interview_experience_ratings")
      .update({
        deleted_at: deletedAt,
        deleted_by: ownerId || null,
        delete_reason: "user_deleted",
      })
      .is("deleted_at", null)
      .in("session_id", sessionUuidsToDelete);
    if (ownerId) deleteQuery = deleteQuery.eq("owner_id", ownerId);
    const { data, error } = await deleteQuery.select("id");

    if (error) throw new Error(`Failed to delete interview rating: ${error.message}`);
    ratingsDeleted = data?.length ?? 0;
  }

  const remainingRows = await findHistoryRows(supabase, uniqueStrings([...candidateIds, ...sessionIdsToDelete]), ownerId);
  const remaining = remainingRows.length;
  const remainingSessions = await countRemainingInterviewSessions(supabase, sessionUuidsToDelete, ownerId);
  const matchedBefore = matchedRows.length;

  return {
    ok: remaining === 0 && remainingSessions === 0,
    deleted: historyDeleted + sessionsDeleted + ratingsDeleted > 0,
    softDeleted: historyDeleted + sessionsDeleted + ratingsDeleted > 0,
    historyDeleted,
    sessionsDeleted,
    ratingsDeleted,
    matchedBefore,
    remaining,
    remainingSessions,
  };
}

async function findHistoryRows(
  supabase: ReturnType<typeof getSupabaseClient>,
  keys: string[],
  ownerId?: string
): Promise<Array<{ id: string; sessionId: string }>> {
  const lookupKeys = uniqueStrings(keys);
  if (!lookupKeys.length) return [];

  const byId = await queryHistoryRowsByColumn(supabase, "id", lookupKeys, ownerId);
  const bySessionId = await queryHistoryRowsByColumn(supabase, "session_id", lookupKeys, ownerId);

  const rows = [...byId, ...bySessionId];
  const deduped = new Map<string, { id: string; sessionId: string }>();
  for (const row of rows) {
    deduped.set(row.id as string, {
      id: row.id as string,
      sessionId: row.session_id as string,
    });
  }
  return Array.from(deduped.values());
}

async function queryHistoryRowsByColumn(
  supabase: ReturnType<typeof getSupabaseClient>,
  column: "id" | "session_id",
  keys: string[],
  ownerId?: string
): Promise<Array<Record<string, unknown>>> {
  let query = supabase
    .from("interview_history")
    .select("id, session_id")
    .is("deleted_at", null)
    .in(column, keys);
  if (ownerId) query = query.eq("owner_id", ownerId);
  const { data, error } = await query;

  if (!error) return data || [];

  const uuidKeys = keys.filter(isUUID);
  if (uuidKeys.length && uuidKeys.length !== keys.length && /uuid|syntax|invalid/i.test(error.message)) {
    let retryQuery = supabase
      .from("interview_history")
      .select("id, session_id")
      .is("deleted_at", null)
      .in(column, uuidKeys);
    if (ownerId) retryQuery = retryQuery.eq("owner_id", ownerId);
    const retry = await retryQuery;
    if (!retry.error) return retry.data || [];
  }

  throw new Error(`Failed to find interview records by ${column}: ${error.message}`);
}

async function queryHistoryRecordRowsByColumn(
  supabase: ReturnType<typeof getSupabaseClient>,
  column: "id" | "session_id",
  keys: string[],
  ownerId?: string
): Promise<Array<Record<string, unknown>>> {
  let query = supabase
    .from("interview_history")
    .select("*")
    .is("deleted_at", null)
    .in(column, keys);
  if (ownerId) query = query.eq("owner_id", ownerId);
  const { data, error } = await query;

  if (!error) return data || [];

  const uuidKeys = keys.filter(isUUID);
  if (uuidKeys.length && uuidKeys.length !== keys.length && /uuid|syntax|invalid/i.test(error.message)) {
    let retryQuery = supabase
      .from("interview_history")
      .select("*")
      .is("deleted_at", null)
      .in(column, uuidKeys);
    if (ownerId) retryQuery = retryQuery.eq("owner_id", ownerId);
    const retry = await retryQuery;
    if (!retry.error) return retry.data || [];
  }

  throw new Error(`Failed to get interview records by ${column}: ${error.message}`);
}

async function countRemainingInterviewSessions(
  supabase: ReturnType<typeof getSupabaseClient>,
  sessionIds: string[],
  ownerId?: string
): Promise<number> {
  const lookupIds = uniqueStrings(sessionIds).filter(isUUID);
  if (!lookupIds.length) return 0;

  let query = supabase
    .from("interview_sessions")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null)
    .in("id", lookupIds);
  if (ownerId) query = query.eq("owner_id", ownerId);
  const { count, error } = await query;

  if (error) throw new Error(`Failed to verify interview session deletion: ${error.message}`);
  return count ?? 0;
}

function isUUID(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function findExistingHistoryRecord(
  supabase: ReturnType<typeof getSupabaseClient>,
  sessionId: string,
  ownerId: string
): Promise<{ id: string; reportedAt: number } | null> {
  const { data, error } = await supabase
    .from("interview_history")
    .select("id, reported_at")
    .eq("session_id", sessionId)
    .eq("owner_id", ownerId)
    .is("deleted_at", null)
    .order("reported_at", { ascending: true })
    .limit(1);

  if (error || !data?.length) return null;
  return {
    id: data[0].id as string,
    reportedAt: new Date(data[0].reported_at as string).getTime(),
  };
}

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  return Array.from(new Set(values.map((value) => value?.trim()).filter(Boolean) as string[]));
}

function rowToRecord(row: Record<string, unknown>): InterviewHistoryRecord {
  return {
    id: row.id as string,
    ownerId: (row.owner_id as string) || "",
    sessionId: row.session_id as string,
    resume: row.resume as string,
    company: row.company as string,
    jobTitle: row.job_title as string,
    jd: row.jd as string,
    interviewType: row.interview_type as InterviewHistoryRecord["interviewType"],
    language: row.language as InterviewHistoryRecord["language"],
    persona: row.persona as InterviewHistoryRecord["persona"],
    difficulty: row.difficulty as InterviewHistoryRecord["difficulty"],
    mode: row.mode as InterviewHistoryRecord["mode"],
    rounds: (row.rounds as Round[]) || [],
    report: row.report as Report,
    createdAt: new Date(row.created_at as string).getTime(),
    reportedAt: new Date(row.reported_at as string).getTime(),
  };
}
