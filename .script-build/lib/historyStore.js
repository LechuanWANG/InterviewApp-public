"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveInterviewRecord = saveInterviewRecord;
exports.listInterviewRecords = listInterviewRecords;
exports.getInterviewRecordById = getInterviewRecordById;
exports.getInterviewRecords = getInterviewRecords;
exports.deleteInterviewRecord = deleteInterviewRecord;
const supabase_1 = require("./supabase");
async function saveInterviewRecord(session) {
    if (!session.report)
        return null;
    const supabase = (0, supabase_1.getSupabaseClient)();
    const existing = await findExistingHistoryRecord(supabase, session.id, session.ownerId);
    const recordId = existing?.id || session.id;
    const reportedAt = existing?.reportedAt || Date.now();
    const record = {
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
    }, { onConflict: "id" });
    if (error)
        throw new Error(`Failed to save interview record: ${error.message}`);
    return record;
}
async function listInterviewRecords(ownerId) {
    const supabase = (0, supabase_1.getSupabaseClient)();
    let query = supabase
        .from("interview_history")
        .select("*")
        .order("reported_at", { ascending: false });
    if (ownerId)
        query = query.eq("owner_id", ownerId);
    const { data, error } = await query;
    if (error)
        throw new Error(`Failed to list interview records: ${error.message}`);
    return (data || []).map(rowToRecord);
}
async function getInterviewRecordById(id, ownerId) {
    const supabase = (0, supabase_1.getSupabaseClient)();
    let query = supabase
        .from("interview_history")
        .select("*")
        .or(`id.eq.${id},session_id.eq.${id}`)
        .limit(1);
    if (ownerId)
        query = query.eq("owner_id", ownerId);
    const { data, error } = await query.single();
    if (error || !data)
        return null;
    return rowToRecord(data);
}
async function getInterviewRecords(ids, ownerId) {
    const lookupIds = uniqueStrings(ids);
    if (!lookupIds.length)
        return [];
    const supabase = (0, supabase_1.getSupabaseClient)();
    const byId = await queryHistoryRecordRowsByColumn(supabase, "id", lookupIds, ownerId);
    const bySessionId = await queryHistoryRecordRowsByColumn(supabase, "session_id", lookupIds, ownerId);
    const deduped = new Map();
    for (const row of [...byId, ...bySessionId]) {
        deduped.set(row.id, row);
    }
    return Array.from(deduped.values())
        .sort((a, b) => {
        const left = new Date(a.reported_at).getTime();
        const right = new Date(b.reported_at).getTime();
        return right - left;
    })
        .map(rowToRecord);
}
async function deleteInterviewRecord(id, sessionId, ownerId) {
    const supabase = (0, supabase_1.getSupabaseClient)();
    const candidateIds = uniqueStrings([id, sessionId]);
    const matchedRows = await findHistoryRows(supabase, candidateIds, ownerId);
    const matchedHistoryIds = uniqueStrings(matchedRows.map((row) => row.id));
    const matchedSessionIds = uniqueStrings(matchedRows.map((row) => row.sessionId));
    const sessionIdsToDelete = uniqueStrings([...candidateIds, ...matchedSessionIds]);
    const sessionUuidsToDelete = sessionIdsToDelete.filter(isUUID);
    let historyDeleted = 0;
    if (matchedHistoryIds.length) {
        let deleteQuery = supabase
            .from("interview_history")
            .delete()
            .in("id", matchedHistoryIds);
        if (ownerId)
            deleteQuery = deleteQuery.eq("owner_id", ownerId);
        const { data, error } = await deleteQuery.select("id");
        if (error)
            throw new Error(`Failed to delete interview record: ${error.message}`);
        historyDeleted += data?.length ?? 0;
    }
    if (sessionIdsToDelete.length) {
        let deleteQuery = supabase
            .from("interview_history")
            .delete()
            .in("session_id", sessionIdsToDelete);
        if (ownerId)
            deleteQuery = deleteQuery.eq("owner_id", ownerId);
        const { data, error } = await deleteQuery.select("id");
        if (error)
            throw new Error(`Failed to delete interview records by session: ${error.message}`);
        historyDeleted += data?.length ?? 0;
    }
    let sessionsDeleted = 0;
    if (sessionUuidsToDelete.length) {
        let deleteQuery = supabase
            .from("interview_sessions")
            .delete()
            .in("id", sessionUuidsToDelete);
        if (ownerId)
            deleteQuery = deleteQuery.eq("owner_id", ownerId);
        const { data, error } = await deleteQuery.select("id");
        if (error)
            throw new Error(`Failed to delete interview session: ${error.message}`);
        sessionsDeleted = data?.length ?? 0;
    }
    const remainingRows = await findHistoryRows(supabase, uniqueStrings([...candidateIds, ...sessionIdsToDelete]), ownerId);
    const remaining = remainingRows.length;
    const remainingSessions = await countRemainingInterviewSessions(supabase, sessionUuidsToDelete, ownerId);
    const matchedBefore = matchedRows.length;
    return {
        ok: remaining === 0 && remainingSessions === 0,
        deleted: historyDeleted + sessionsDeleted > 0,
        historyDeleted,
        sessionsDeleted,
        matchedBefore,
        remaining,
        remainingSessions,
    };
}
async function findHistoryRows(supabase, keys, ownerId) {
    const lookupKeys = uniqueStrings(keys);
    if (!lookupKeys.length)
        return [];
    const byId = await queryHistoryRowsByColumn(supabase, "id", lookupKeys, ownerId);
    const bySessionId = await queryHistoryRowsByColumn(supabase, "session_id", lookupKeys, ownerId);
    const rows = [...byId, ...bySessionId];
    const deduped = new Map();
    for (const row of rows) {
        deduped.set(row.id, {
            id: row.id,
            sessionId: row.session_id,
        });
    }
    return Array.from(deduped.values());
}
async function queryHistoryRowsByColumn(supabase, column, keys, ownerId) {
    let query = supabase
        .from("interview_history")
        .select("id, session_id")
        .in(column, keys);
    if (ownerId)
        query = query.eq("owner_id", ownerId);
    const { data, error } = await query;
    if (!error)
        return data || [];
    const uuidKeys = keys.filter(isUUID);
    if (uuidKeys.length && uuidKeys.length !== keys.length && /uuid|syntax|invalid/i.test(error.message)) {
        let retryQuery = supabase
            .from("interview_history")
            .select("id, session_id")
            .in(column, uuidKeys);
        if (ownerId)
            retryQuery = retryQuery.eq("owner_id", ownerId);
        const retry = await retryQuery;
        if (!retry.error)
            return retry.data || [];
    }
    throw new Error(`Failed to find interview records by ${column}: ${error.message}`);
}
async function queryHistoryRecordRowsByColumn(supabase, column, keys, ownerId) {
    let query = supabase
        .from("interview_history")
        .select("*")
        .in(column, keys);
    if (ownerId)
        query = query.eq("owner_id", ownerId);
    const { data, error } = await query;
    if (!error)
        return data || [];
    const uuidKeys = keys.filter(isUUID);
    if (uuidKeys.length && uuidKeys.length !== keys.length && /uuid|syntax|invalid/i.test(error.message)) {
        let retryQuery = supabase
            .from("interview_history")
            .select("*")
            .in(column, uuidKeys);
        if (ownerId)
            retryQuery = retryQuery.eq("owner_id", ownerId);
        const retry = await retryQuery;
        if (!retry.error)
            return retry.data || [];
    }
    throw new Error(`Failed to get interview records by ${column}: ${error.message}`);
}
async function countRemainingInterviewSessions(supabase, sessionIds, ownerId) {
    const lookupIds = uniqueStrings(sessionIds).filter(isUUID);
    if (!lookupIds.length)
        return 0;
    let query = supabase
        .from("interview_sessions")
        .select("id", { count: "exact", head: true })
        .in("id", lookupIds);
    if (ownerId)
        query = query.eq("owner_id", ownerId);
    const { count, error } = await query;
    if (error)
        throw new Error(`Failed to verify interview session deletion: ${error.message}`);
    return count ?? 0;
}
function isUUID(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
async function findExistingHistoryRecord(supabase, sessionId, ownerId) {
    const { data, error } = await supabase
        .from("interview_history")
        .select("id, reported_at")
        .eq("session_id", sessionId)
        .eq("owner_id", ownerId)
        .order("reported_at", { ascending: true })
        .limit(1);
    if (error || !data?.length)
        return null;
    return {
        id: data[0].id,
        reportedAt: new Date(data[0].reported_at).getTime(),
    };
}
function uniqueStrings(values) {
    return Array.from(new Set(values.map((value) => value?.trim()).filter(Boolean)));
}
function rowToRecord(row) {
    return {
        id: row.id,
        ownerId: row.owner_id || "",
        sessionId: row.session_id,
        resume: row.resume,
        company: row.company,
        jobTitle: row.job_title,
        jd: row.jd,
        interviewType: row.interview_type,
        language: row.language,
        persona: row.persona,
        difficulty: row.difficulty,
        mode: row.mode,
        rounds: row.rounds || [],
        report: row.report,
        createdAt: new Date(row.created_at).getTime(),
        reportedAt: new Date(row.reported_at).getTime(),
    };
}
