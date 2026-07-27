"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSession = createSession;
exports.getSession = getSession;
exports.updateSession = updateSession;
const crypto_1 = require("crypto");
const supabase_1 = require("./supabase");
async function createSession(data) {
    const supabase = (0, supabase_1.getSupabaseClient)();
    const now = Date.now();
    const session = {
        ...data,
        id: (0, crypto_1.randomUUID)(),
        plan: null,
        rounds: [],
        currentQuestion: null,
        currentIsFollowUp: false,
        status: "created",
        report: null,
        createdAt: now,
    };
    const { error } = await supabase.from("interview_sessions").insert({
        id: session.id,
        owner_id: session.ownerId,
        resume: session.resume,
        company: session.company,
        job_title: session.jobTitle,
        jd: session.jd,
        interview_type: session.interviewType,
        language: session.language,
        persona: session.persona,
        difficulty: session.difficulty,
        mode: session.mode,
        provider: session.provider,
        model: session.model,
        thinking_enabled: session.thinkingEnabled,
        plan: session.plan,
        rounds: session.rounds,
        current_question: session.currentQuestion,
        current_is_follow_up: session.currentIsFollowUp,
        status: session.status,
        report: session.report,
        created_at: new Date(session.createdAt).toISOString(),
    });
    if (error)
        throw new Error(`Failed to create session: ${error.message}`);
    return session;
}
async function getSession(id, ownerId) {
    const supabase = (0, supabase_1.getSupabaseClient)();
    let query = supabase
        .from("interview_sessions")
        .select("*")
        .eq("id", id);
    if (ownerId)
        query = query.eq("owner_id", ownerId);
    const { data, error } = await query.single();
    if (error || !data)
        return undefined;
    return rowToSession(data);
}
async function updateSession(id, patch, ownerId) {
    const supabase = (0, supabase_1.getSupabaseClient)();
    const dbPatch = {};
    if (patch.plan !== undefined)
        dbPatch.plan = patch.plan;
    if (patch.rounds !== undefined)
        dbPatch.rounds = patch.rounds;
    if (patch.currentQuestion !== undefined)
        dbPatch.current_question = patch.currentQuestion;
    if (patch.currentIsFollowUp !== undefined)
        dbPatch.current_is_follow_up = patch.currentIsFollowUp;
    if (patch.status !== undefined)
        dbPatch.status = patch.status;
    if (patch.report !== undefined)
        dbPatch.report = patch.report;
    if (Object.keys(dbPatch).length === 0) {
        return getSession(id, ownerId);
    }
    let query = supabase
        .from("interview_sessions")
        .update(dbPatch)
        .eq("id", id);
    if (ownerId)
        query = query.eq("owner_id", ownerId);
    const { data, error } = await query.select("*").single();
    if (error || !data)
        return undefined;
    return rowToSession(data);
}
function rowToSession(row) {
    return {
        id: row.id,
        ownerId: row.owner_id || "",
        resume: row.resume,
        company: row.company,
        jobTitle: row.job_title,
        jd: row.jd,
        interviewType: row.interview_type,
        language: row.language,
        persona: row.persona,
        difficulty: row.difficulty,
        mode: row.mode,
        provider: row.provider,
        model: row.model,
        thinkingEnabled: row.thinking_enabled || false,
        plan: row.plan || null,
        rounds: row.rounds || [],
        currentQuestion: row.current_question || null,
        currentIsFollowUp: row.current_is_follow_up || false,
        status: row.status,
        report: row.report || null,
        createdAt: new Date(row.created_at).getTime(),
    };
}
