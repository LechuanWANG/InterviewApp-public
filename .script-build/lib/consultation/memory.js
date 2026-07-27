"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CONSULT_PROFILE_ID = void 0;
exports.buildConsultMemorySnapshot = buildConsultMemorySnapshot;
exports.buildConsultMemoryDigest = buildConsultMemoryDigest;
exports.buildConversationCoverageDigest = buildConversationCoverageDigest;
const issues_1 = require("./issues");
exports.DEFAULT_CONSULT_PROFILE_ID = "local-default-user";
const TOPIC_RULES = [
    {
        topic: "job_direction",
        label: "岗位方向",
        keywords: ["方向", "岗位", "转岗", "赛道", "选择", "主攻", "求职目标"],
    },
    {
        topic: "job_motivation",
        label: "岗位动机",
        keywords: ["动机", "为什么投", "为什么选择", "想做", "兴趣", "匹配"],
    },
    {
        topic: "project_depth",
        label: "项目深挖",
        keywords: ["项目", "实习", "经历", "案例", "负责", "难点", "贡献"],
    },
    {
        topic: "expression_logic",
        label: "逻辑表达",
        keywords: ["逻辑", "表达", "结构", "讲清楚", "条理", "沟通"],
    },
    {
        topic: "evidence_results",
        label: "结果证据",
        keywords: ["数据", "指标", "结果", "证据", "量化", "产出", "效果"],
    },
    {
        topic: "practice_plan",
        label: "练习计划",
        keywords: ["练习", "计划", "准备", "复盘", "训练", "下一步"],
    },
    {
        topic: "resume_background",
        label: "简历背景",
        keywords: ["简历", "专业", "学历", "背景", "学校", "教育"],
    },
    {
        topic: "team_communication",
        label: "团队协作",
        keywords: ["团队", "协作", "沟通", "同学", "同事", "冲突", "合作"],
    },
];
async function buildConsultMemorySnapshot(params) {
    const profileId = params.profileId || exports.DEFAULT_CONSULT_PROFILE_ID;
    const resolvedIssueKeys = await (0, issues_1.getResolvedIssueKeys)(profileId);
    const sessions = params.sessions
        .filter((session) => session.id !== params.currentSessionId &&
        session.memoryProfileId === profileId &&
        session.memoryEnabled !== false &&
        getMemorySaveStatus(session) === "saved" &&
        (session.status === "completed" || !!session.summary))
        .sort((left, right) => (right.endedAt || right.updatedAt) - (left.endedAt || left.updatedAt));
    const targetRoles = createTextCollector(5);
    const avoidRoles = createTextCollector(5);
    const repeatedIssues = createTextCollector(6);
    const recentAdvice = createTextCollector(6);
    const recentQuestions = createTextCollector(6);
    const topicCounts = new Map();
    let latestJudgement = null;
    let latestPrimaryTarget = null;
    let updatedAt = null;
    for (const session of sessions) {
        const sessionTopics = new Set();
        for (const record of session.records) {
            targetRoles.push(record.jobTitle);
            collectTopics(record.jobTitle, sessionTopics);
            for (const weakness of record.report.weaknesses || []) {
                if (isResolvedIssue(weakness, resolvedIssueKeys))
                    continue;
                collectTopics(weakness, sessionTopics);
            }
            for (const advice of record.report.improvementAdvice || []) {
                if (isResolvedIssue(advice, resolvedIssueKeys))
                    continue;
                collectTopics(advice, sessionTopics);
            }
            for (const review of record.report.roundReviews || []) {
                collectTopics(review.overallComment, sessionTopics);
                if (!isResolvedIssue(review.mainIssue || "", resolvedIssueKeys)) {
                    collectTopics(review.mainIssue || "", sessionTopics);
                }
                collectTopics(review.mainStrength || "", sessionTopics);
                if (!isResolvedIssue(review.nextStep || "", resolvedIssueKeys)) {
                    collectTopics(review.nextStep || "", sessionTopics);
                }
            }
        }
        for (const message of session.messages) {
            collectTopics(message.content, sessionTopics);
            if (message.role === "assistant") {
                for (const question of extractQuestionCandidates(message.content)) {
                    recentQuestions.push(question);
                }
            }
        }
        if (session.summary) {
            if (!latestJudgement)
                latestJudgement = session.summary.currentJudgement;
            if (!latestPrimaryTarget)
                latestPrimaryTarget = session.summary.primaryTarget;
            repeatedIssues.pushMany(session.summary.repeatedIssues.filter((item) => !isResolvedIssue(item, resolvedIssueKeys)));
            recentAdvice.pushMany(session.summary.nextPracticeFocus.filter((item) => !isResolvedIssue(item, resolvedIssueKeys)));
            recentAdvice.pushMany(session.summary.sevenDayPlan.filter((item) => !isResolvedIssue(item, resolvedIssueKeys)));
            avoidRoles.pushMany(session.summary.notRecommended);
            targetRoles.push(session.summary.primaryTarget);
            collectTopics(session.summary.currentJudgement, sessionTopics);
            collectTopics(session.summary.primaryTarget, sessionTopics);
            session.summary.repeatedIssues
                .filter((item) => !isResolvedIssue(item, resolvedIssueKeys))
                .forEach((item) => collectTopics(item, sessionTopics));
            session.summary.nextPracticeFocus
                .filter((item) => !isResolvedIssue(item, resolvedIssueKeys))
                .forEach((item) => collectTopics(item, sessionTopics));
            session.summary.sevenDayPlan
                .filter((item) => !isResolvedIssue(item, resolvedIssueKeys))
                .forEach((item) => collectTopics(item, sessionTopics));
        }
        for (const topic of sessionTopics) {
            topicCounts.set(topic, (topicCounts.get(topic) || 0) + 1);
        }
        if (updatedAt === null) {
            updatedAt = session.endedAt || session.updatedAt || session.createdAt;
        }
    }
    const discussedTopics = Array.from(topicCounts.entries())
        .sort((left, right) => right[1] - left[1])
        .slice(0, 5)
        .map(([topic, count]) => ({
        topic,
        count,
        label: TOPIC_RULES.find((item) => item.topic === topic)?.label || topic,
    }));
    return {
        profileId,
        pastSessionCount: sessions.length,
        latestJudgement,
        latestPrimaryTarget,
        targetRoles: targetRoles.values(),
        avoidRoles: avoidRoles.values(),
        repeatedIssues: repeatedIssues.values(),
        recentAdvice: recentAdvice.values(),
        discussedTopics,
        recentQuestions: recentQuestions.values(),
        updatedAt,
    };
}
function isResolvedIssue(text, resolvedIssueKeys) {
    return !!text && resolvedIssueKeys.has((0, issues_1.normalizeIssueKey)(text));
}
function getMemorySaveStatus(session) {
    if (session.memorySaveStatus === "pending" ||
        session.memorySaveStatus === "saved" ||
        session.memorySaveStatus === "excluded") {
        return session.memorySaveStatus;
    }
    return session.memoryEnabled === false ? "excluded" : "saved";
}
function buildConsultMemoryDigest(memory) {
    if (!memory.pastSessionCount) {
        return "暂无历史战略咨询记忆，这是用户的第一场或尚未完成过战略咨询。";
    }
    const lines = [`已完成战略咨询 ${memory.pastSessionCount} 场。`];
    if (memory.latestJudgement)
        lines.push(`最近一次总体判断：${memory.latestJudgement}`);
    if (memory.latestPrimaryTarget)
        lines.push(`最近一次主攻方向：${memory.latestPrimaryTarget}`);
    if (memory.targetRoles.length)
        lines.push(`历史高频目标方向：${memory.targetRoles.join("；")}`);
    if (memory.avoidRoles.length)
        lines.push(`历史暂不建议方向：${memory.avoidRoles.join("；")}`);
    if (memory.repeatedIssues.length)
        lines.push(`历史反复问题：${memory.repeatedIssues.join("；")}`);
    if (memory.recentAdvice.length)
        lines.push(`历史已给过的建议：${memory.recentAdvice.join("；")}`);
    if (memory.discussedTopics.length) {
        lines.push(`历史已反复讨论的话题：${memory.discussedTopics
            .map((item) => `${item.label}(${item.count})`)
            .join("、")}`);
    }
    if (memory.recentQuestions.length) {
        lines.push(`最近已经追问过的问题：${memory.recentQuestions.join("；")}`);
    }
    lines.push("除非用户明确改变想法或信息出现冲突，否则不要原样重复追问以上背景和问题，应在已知基础上继续推进。");
    return lines.join("\n");
}
function buildConversationCoverageDigest(messages) {
    if (!messages.length) {
        return "当前会话刚开始，尚无已覆盖内容。";
    }
    const topics = new Set();
    const questions = createTextCollector(4);
    for (const message of messages) {
        collectTopics(message.content, topics);
        if (message.role === "assistant") {
            for (const question of extractQuestionCandidates(message.content)) {
                questions.push(question);
            }
        }
    }
    const topicLabels = Array.from(topics)
        .map((topic) => TOPIC_RULES.find((item) => item.topic === topic)?.label || topic)
        .slice(0, 5);
    const lines = [];
    lines.push(topicLabels.length ? `当前会话已覆盖话题：${topicLabels.join("、")}` : "当前会话尚未形成明确话题。");
    if (questions.values().length) {
        lines.push(`当前会话已经问过的问题：${questions.values().join("；")}`);
    }
    lines.push("不要换个说法重复问同一层问题；如果要继续追问，必须更深入，或者推进到下一步建议。");
    return lines.join("\n");
}
function collectTopics(text, bucket) {
    const normalized = normalizeText(text);
    if (!normalized)
        return;
    for (const rule of TOPIC_RULES) {
        if (rule.keywords.some((keyword) => normalized.includes(keyword))) {
            bucket.add(rule.topic);
        }
    }
}
function extractQuestionCandidates(text) {
    const matches = text.match(/[^？?\n]{4,48}[？?]/g) || [];
    return uniqueTexts(matches.map((item) => item.replace(/[？?]/g, "").trim()), 6);
}
function normalizeText(text) {
    return text.replace(/\s+/g, "").trim();
}
function uniqueTexts(items, limit) {
    const seen = new Set();
    const result = [];
    for (const item of items) {
        const normalized = item.replace(/[，。！？；、\s]/g, "");
        if (!normalized || seen.has(normalized))
            continue;
        seen.add(normalized);
        result.push(item);
        if (result.length >= limit)
            break;
    }
    return result;
}
function createTextCollector(limit) {
    const items = [];
    return {
        push(value) {
            if (!value?.trim())
                return;
            const next = uniqueTexts([value.trim(), ...items], limit);
            items.splice(0, items.length, ...next);
        },
        pushMany(values) {
            for (const value of values)
                this.push(value);
        },
        values() {
            return items.slice(0, limit);
        },
    };
}
