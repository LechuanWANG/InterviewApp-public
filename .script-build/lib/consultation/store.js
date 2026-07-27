"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createConsultSession = createConsultSession;
exports.getConsultSession = getConsultSession;
exports.listConsultSessions = listConsultSessions;
exports.appendConsultMessage = appendConsultMessage;
exports.completeConsultSession = completeConsultSession;
exports.updateConsultMemorySaveStatus = updateConsultMemorySaveStatus;
exports.reopenConsultSession = reopenConsultSession;
exports.deleteConsultSession = deleteConsultSession;
const crypto_1 = require("crypto");
const supabase_1 = require("../supabase");
const memory_1 = require("./memory");
const models_1 = require("../llm/models");
async function createConsultSession(params) {
    const supabase = (0, supabase_1.getSupabaseClient)();
    const now = Date.now();
    const defaultModel = (0, models_1.findModel)(models_1.DEFAULT_MODEL_ID);
    const sessionId = (0, crypto_1.randomUUID)();
    const firstMessageId = (0, crypto_1.randomUUID)();
    const session = {
        id: sessionId,
        ownerId: params.ownerId,
        selectedInterviewSessionIds: params.records.map((record) => record.id),
        summaryMode: params.records.length === 1 ? "single_session" : "multi_session",
        goal: params.goal,
        mentorType: "zhang_xuefeng_style",
        memoryProfileId: params.memoryProfileId || `user:${params.ownerId}` || memory_1.DEFAULT_CONSULT_PROFILE_ID,
        memoryEnabled: params.memoryEnabled ?? true,
        memorySaveStatus: params.memoryEnabled === false ? "excluded" : "pending",
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
    if (sessionError)
        throw new Error(`Failed to create consult session: ${sessionError.message}`);
    const { error: msgError } = await supabase.from("consult_messages").insert({
        id: firstMessageId,
        owner_id: params.ownerId,
        session_id: sessionId,
        role: "assistant",
        content: params.firstMessage,
        created_at: new Date(now).toISOString(),
    });
    if (msgError)
        throw new Error(`Failed to create consult message: ${msgError.message}`);
    return session;
}
async function getConsultSession(id, ownerId) {
    const supabase = (0, supabase_1.getSupabaseClient)();
    let sessionQuery = supabase
        .from("consult_sessions")
        .select("*")
        .eq("id", id);
    if (ownerId)
        sessionQuery = sessionQuery.eq("owner_id", ownerId);
    const { data: sessionRow, error } = await sessionQuery.single();
    if (error || !sessionRow)
        return undefined;
    let messageQuery = supabase
        .from("consult_messages")
        .select("*")
        .eq("session_id", id)
        .order("created_at", { ascending: true });
    if (ownerId)
        messageQuery = messageQuery.eq("owner_id", ownerId);
    const { data: messageRows, error: msgError } = await messageQuery;
    if (msgError)
        throw new Error(`Failed to fetch messages: ${msgError.message}`);
    return rowToSession(sessionRow, messageRows || []);
}
async function listConsultSessions(ownerId) {
    const supabase = (0, supabase_1.getSupabaseClient)();
    let sessionQuery = supabase
        .from("consult_sessions")
        .select("*")
        .order("created_at", { ascending: false });
    if (ownerId)
        sessionQuery = sessionQuery.eq("owner_id", ownerId);
    const { data: sessionRows, error } = await sessionQuery;
    if (error)
        throw new Error(`Failed to list consult sessions: ${error.message}`);
    if (!sessionRows || sessionRows.length === 0)
        return [];
    const sessionIds = sessionRows.map((row) => row.id);
    let messageQuery = supabase
        .from("consult_messages")
        .select("*")
        .in("session_id", sessionIds)
        .order("created_at", { ascending: true });
    if (ownerId)
        messageQuery = messageQuery.eq("owner_id", ownerId);
    const { data: messageRows, error: msgError } = await messageQuery;
    if (msgError)
        throw new Error(`Failed to fetch messages: ${msgError.message}`);
    const messagesBySession = new Map();
    for (const msg of messageRows || []) {
        const sid = msg.session_id;
        if (!messagesBySession.has(sid))
            messagesBySession.set(sid, []);
        messagesBySession.get(sid).push(msg);
    }
    return sessionRows.map((row) => rowToSession(row, messagesBySession.get(row.id) || []));
}
async function appendConsultMessage(id, role, content, ownerId) {
    const supabase = (0, supabase_1.getSupabaseClient)();
    const message = {
        id: (0, crypto_1.randomUUID)(),
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
    if (msgError)
        throw new Error(`Failed to append message: ${msgError.message}`);
    let updateQuery = supabase
        .from("consult_sessions")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", id);
    if (ownerId)
        updateQuery = updateQuery.eq("owner_id", ownerId);
    const { error: updateError } = await updateQuery;
    if (updateError)
        throw new Error(`Failed to update session timestamp: ${updateError.message}`);
    return message;
}
async function completeConsultSession(id, summary, endedBy, ownerId) {
    const supabase = (0, supabase_1.getSupabaseClient)();
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
        .eq("id", id);
    if (ownerId)
        query = query.eq("owner_id", ownerId);
    const { error } = await query;
    if (error)
        throw new Error(`Failed to complete consult session: ${error.message}`);
    return getConsultSession(id, ownerId);
}
async function updateConsultMemorySaveStatus(id, memorySaveStatus, ownerId) {
    const supabase = (0, supabase_1.getSupabaseClient)();
    const updates = {
        memory_save_status: memorySaveStatus,
        updated_at: new Date().toISOString(),
    };
    if (memorySaveStatus === "saved") {
        updates.memory_enabled = true;
    }
    let query = supabase
        .from("consult_sessions")
        .update(updates)
        .eq("id", id);
    if (ownerId)
        query = query.eq("owner_id", ownerId);
    const { error } = await query;
    if (error)
        throw new Error(`Failed to update memory save status: ${error.message}`);
    return getConsultSession(id, ownerId);
}
async function reopenConsultSession(id, ownerId) {
    const supabase = (0, supabase_1.getSupabaseClient)();
    let query = supabase
        .from("consult_sessions")
        .update({
        status: "active",
        ended_by: null,
        ended_at: null,
        updated_at: new Date().toISOString(),
    })
        .eq("id", id);
    if (ownerId)
        query = query.eq("owner_id", ownerId);
    const { error } = await query;
    if (error)
        throw new Error(`Failed to reopen consult session: ${error.message}`);
    return getConsultSession(id, ownerId);
}
async function deleteConsultSession(id, ownerId) {
    const supabase = (0, supabase_1.getSupabaseClient)();
    let messageQuery = supabase
        .from("consult_messages")
        .delete()
        .eq("session_id", id);
    if (ownerId)
        messageQuery = messageQuery.eq("owner_id", ownerId);
    const { error: messageError } = await messageQuery;
    if (messageError)
        throw new Error(`Failed to delete consult messages: ${messageError.message}`);
    let sessionDeleteQuery = supabase
        .from("consult_sessions")
        .delete({ count: "exact" })
        .eq("id", id);
    if (ownerId)
        sessionDeleteQuery = sessionDeleteQuery.eq("owner_id", ownerId);
    const { error, count } = await sessionDeleteQuery;
    if (error)
        throw new Error(`Failed to delete consult session: ${error.message}`);
    return (count ?? 0) > 0;
}
function rowToSession(row, messageRows) {
    return {
        id: row.id,
        ownerId: row.owner_id || "",
        selectedInterviewSessionIds: row.selected_interview_session_ids || [],
        summaryMode: row.summary_mode,
        goal: row.goal,
        mentorType: row.mentor_type || "zhang_xuefeng_style",
        memoryProfileId: row.memory_profile_id || memory_1.DEFAULT_CONSULT_PROFILE_ID,
        memoryEnabled: row.memory_enabled ?? true,
        memorySaveStatus: row.memory_save_status || "pending",
        provider: row.provider,
        model: row.model,
        status: row.status,
        endedBy: row.ended_by || null,
        records: row.records || [],
        messages: messageRows.map((msg) => ({
            id: msg.id,
            ownerId: msg.owner_id || "",
            role: msg.role,
            content: msg.content,
            createdAt: new Date(msg.created_at).getTime(),
        })),
        summary: row.summary || null,
        createdAt: new Date(row.created_at).getTime(),
        updatedAt: new Date(row.updated_at).getTime(),
        endedAt: row.ended_at ? new Date(row.ended_at).getTime() : undefined,
    };
}
