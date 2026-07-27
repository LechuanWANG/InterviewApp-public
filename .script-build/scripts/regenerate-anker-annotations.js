"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const supabase_js_1 = require("@supabase/supabase-js");
const fs_1 = require("fs");
const path_1 = require("path");
const annotateAnswers_1 = require("../lib/prompts/annotateAnswers");
loadEnvLocal();
const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}
const targetCompany = "安克创新";
const targetJobTitle = "组织策略与数据分析方向（人力资源发展岗）";
const targetOwnerId = process.env.DEMO_OWNER_ID || process.env.TARGET_OWNER_ID;
const supabase = (0, supabase_js_1.createClient)(supabaseUrl, serviceRoleKey);
async function main() {
    let query = supabase
        .from("interview_history")
        .select("*")
        .eq("company", targetCompany)
        .eq("job_title", targetJobTitle)
        .order("reported_at", { ascending: false })
        .limit(1);
    if (targetOwnerId)
        query = query.eq("owner_id", targetOwnerId);
    const { data, error } = await query.single();
    if (error || !data) {
        throw new Error(`Target interview history not found: ${error?.message ?? "empty result"}`);
    }
    const report = data.report;
    const session = {
        id: data.session_id,
        ownerId: data.owner_id,
        resume: data.resume,
        company: data.company,
        jobTitle: data.job_title,
        jd: data.jd,
        interviewType: data.interview_type,
        language: data.language,
        persona: data.persona,
        difficulty: data.difficulty,
        mode: data.mode,
        provider: process.env.DEMO_LLM_PROVIDER || process.env.LLM_PROVIDER || "deepseek",
        model: process.env.DEMO_LLM_MODEL || process.env.DEEPSEEK_MODEL || "deepseek-chat",
        thinkingEnabled: false,
        plan: null,
        rounds: data.rounds || [],
        currentQuestion: null,
        currentIsFollowUp: false,
        status: "finished",
        report,
        createdAt: new Date(data.created_at).getTime(),
    };
    const annotations = await (0, annotateAnswers_1.annotateAnswers)(session, report);
    const nextReport = {
        ...report,
        roundReviews: annotations.roundReviews,
        answerAnnotations: annotations.answerAnnotations,
        annotationSummaries: annotations.annotationSummaries,
    };
    const historyUpdate = await supabase
        .from("interview_history")
        .update({ report: nextReport })
        .eq("id", data.id)
        .select("id")
        .single();
    if (historyUpdate.error) {
        throw new Error(`Failed to update interview_history: ${historyUpdate.error.message}`);
    }
    const sessionId = data.session_id;
    if (sessionId) {
        const sessionUpdate = await supabase
            .from("interview_sessions")
            .update({ report: nextReport })
            .eq("id", sessionId)
            .select("id")
            .maybeSingle();
        if (sessionUpdate.error) {
            throw new Error(`Failed to update interview_sessions: ${sessionUpdate.error.message}`);
        }
    }
    console.log(JSON.stringify({
        ok: true,
        historyId: data.id,
        sessionId,
        rounds: session.rounds.length,
        roundReviews: annotations.roundReviews.length,
        answerAnnotations: annotations.answerAnnotations.length,
        annotationSummaries: annotations.annotationSummaries.length,
    }, null, 2));
}
function loadEnvLocal() {
    for (const file of [".env.local", ".env"]) {
        const envPath = (0, path_1.join)(process.cwd(), file);
        if (!(0, fs_1.existsSync)(envPath))
            continue;
        const raw = (0, fs_1.readFileSync)(envPath, "utf-8");
        for (const line of raw.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#"))
                continue;
            const index = trimmed.indexOf("=");
            if (index <= 0)
                continue;
            const key = trimmed.slice(0, index).trim();
            const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
            if (!process.env[key])
                process.env[key] = value;
        }
    }
}
main().catch((error) => {
    console.error(error);
    process.exit(1);
});
