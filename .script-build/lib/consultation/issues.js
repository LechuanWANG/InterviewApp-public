"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildConsultMemoryIssues = buildConsultMemoryIssues;
exports.getResolvedIssueKeys = getResolvedIssueKeys;
exports.markIssueResolved = markIssueResolved;
exports.restoreIssueToMemory = restoreIssueToMemory;
exports.normalizeIssueKey = normalizeIssueKey;
const supabase_1 = require("../supabase");
const DEFAULT_PROFILE_ID = "local-default-user";
async function buildConsultMemoryIssues(params) {
    const profileId = params.profileId || DEFAULT_PROFILE_ID;
    const resolvedMap = await getResolvedIssueMap(profileId, params.ownerId);
    const issueMap = new Map();
    const sessions = params.sessions
        .filter((session) => session.memoryProfileId === profileId &&
        session.memoryEnabled !== false &&
        getMemorySaveStatus(session) === "saved" &&
        (session.status === "completed" || !!session.summary))
        .sort((left, right) => (right.endedAt || right.updatedAt) - (left.endedAt || left.updatedAt))
        .slice(0, params.recentLimit ?? 8);
    for (const session of sessions) {
        if (session.summary) {
            const sourceTitle = consultSourceTitle(session);
            for (const issue of session.summary.repeatedIssues) {
                addIssue(issueMap, issue, {
                    sourceType: "consultation",
                    sourceId: session.id,
                    sourceTitle,
                    seenAt: session.endedAt || session.updatedAt,
                    resolved: resolvedMap.has(normalizeIssueKey(issue)),
                });
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
        .map((issue) => ({ ...issue, category: "common" }))
        .sort(sortIssues);
    const resolvedIssues = Array.from(resolvedMap.values())
        .map((record) => issueMap.get(record.normalizedKey))
        .filter((issue) => !!issue)
        .map((issue) => ({ ...issue, resolved: true }))
        .sort(sortIssues);
    return {
        commonIssues,
        singleInterviewIssues: [],
        resolvedIssues,
    };
}
async function getResolvedIssueKeys(profileId = DEFAULT_PROFILE_ID, ownerId) {
    const map = await getResolvedIssueMap(profileId, ownerId);
    return new Set(map.keys());
}
async function markIssueResolved(params) {
    const profileId = params.profileId || DEFAULT_PROFILE_ID;
    const normalizedKey = normalizeIssueKey(params.normalizedKey || params.label);
    if (!normalizedKey)
        return;
    const supabase = (0, supabase_1.getSupabaseClient)();
    const { error } = await supabase.from("consult_memory_resolutions").upsert({
        normalized_key: normalizedKey,
        profile_id: profileId,
        owner_id: params.ownerId ?? ownerIdFromProfile(profileId),
        label: params.label || params.normalizedKey,
        resolved_at: new Date().toISOString(),
    });
    if (error)
        throw new Error(`Failed to mark issue resolved: ${error.message}`);
}
async function restoreIssueToMemory(params) {
    const profileId = params.profileId || DEFAULT_PROFILE_ID;
    const supabase = (0, supabase_1.getSupabaseClient)();
    let query = supabase
        .from("consult_memory_resolutions")
        .delete()
        .eq("normalized_key", params.normalizedKey)
        .eq("profile_id", profileId);
    const ownerId = params.ownerId ?? ownerIdFromProfile(profileId);
    if (ownerId)
        query = query.eq("owner_id", ownerId);
    const { error } = await query;
    if (error)
        throw new Error(`Failed to restore issue: ${error.message}`);
}
function normalizeIssueKey(text) {
    return text
        .toLowerCase()
        .replace(/[""'"".?？!！,，。；;：:\s、\-—_]/g, "")
        .replace(/^(问题|短板|建议|主要问题|提高建议|下次优先)/, "")
        .slice(0, 80)
        .trim();
}
function addIssue(issueMap, label, source) {
    const cleaned = cleanIssueLabel(label);
    const normalizedKey = normalizeIssueKey(cleaned);
    if (!cleaned || !normalizedKey)
        return;
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
    if (isNewSource)
        existing.occurrenceCount += 1;
    existing.lastSeenAt = Math.max(existing.lastSeenAt, source.seenAt);
    existing.resolved = existing.resolved || source.resolved;
    if (!existing.sourceTypes.includes(source.sourceType))
        existing.sourceTypes.push(source.sourceType);
    if (isNewSource)
        existing.sourceIds.push(source.sourceId);
    if (!existing.sourceTitles.includes(source.sourceTitle))
        existing.sourceTitles.push(source.sourceTitle);
}
function cleanIssueLabel(label) {
    return label.replace(/\s+/g, " ").replace(/^[-•\d.、\s]+/, "").trim();
}
function issueId(normalizedKey) {
    return Buffer.from(normalizedKey).toString("base64url").slice(0, 32);
}
function consultSourceTitle(session) {
    if (session.records.length === 1) {
        const record = session.records[0];
        return `${record.jobTitle} · ${record.company}`;
    }
    return `战略咨询 ${session.records.length} 场面试`;
}
function getMemorySaveStatus(session) {
    if (session.memorySaveStatus === "pending" ||
        session.memorySaveStatus === "saved" ||
        session.memorySaveStatus === "excluded") {
        return session.memorySaveStatus;
    }
    return session.memoryEnabled === false ? "excluded" : "saved";
}
function sortIssues(left, right) {
    return right.occurrenceCount - left.occurrenceCount || right.lastSeenAt - left.lastSeenAt;
}
async function getResolvedIssueMap(profileId, ownerId) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
        return new Map();
    }
    const supabase = (0, supabase_1.getSupabaseClient)();
    let query = supabase
        .from("consult_memory_resolutions")
        .select("normalized_key, label, resolved_at")
        .eq("profile_id", profileId);
    const resolvedOwnerId = ownerId ?? ownerIdFromProfile(profileId);
    if (resolvedOwnerId)
        query = query.eq("owner_id", resolvedOwnerId);
    const { data, error } = await query;
    if (error)
        throw new Error(`Failed to fetch resolved issues: ${error.message}`);
    const map = new Map();
    for (const row of data || []) {
        map.set(row.normalized_key, {
            normalizedKey: row.normalized_key,
            label: row.label,
            resolvedAt: new Date(row.resolved_at).getTime(),
        });
    }
    return map;
}
function ownerIdFromProfile(profileId) {
    return profileId.startsWith("user:") ? profileId.slice("user:".length) : undefined;
}
