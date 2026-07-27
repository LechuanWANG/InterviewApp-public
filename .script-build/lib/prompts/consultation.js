"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isConsultStopIntent = isConsultStopIntent;
exports.generateConsultOpening = generateConsultOpening;
exports.generateConsultReply = generateConsultReply;
exports.generateConsultSummary = generateConsultSummary;
const langgraphAgent_1 = require("../consultation/langgraphAgent");
function isConsultStopIntent(text) {
    const normalized = text.trim().replace(/[，。！？\s]/g, "");
    if (!normalized)
        return false;
    return [
        "结束",
        "停止",
        "先到这",
        "先到这里",
        "不用继续了",
        "总结一下",
        "咨询一下结论",
        "给我一个结论",
        "帮我生成总结",
        "帮我生成咨询结论",
        "今天先这样",
        "可以了",
    ].some((phrase) => normalized.includes(phrase));
}
async function generateConsultOpening(params) {
    const result = await (0, langgraphAgent_1.runConsultAgent)({
        task: "opening",
        records: params.records,
        goal: params.goal,
        memoryDigest: params.memoryDigest,
        llm: params.llm,
    });
    return result.task === "opening" ? result.message : fallbackOpening(params.records);
}
async function generateConsultReply(params) {
    const result = await (0, langgraphAgent_1.runConsultAgent)({
        task: "reply",
        records: params.records,
        goal: params.goal,
        messages: params.messages,
        userMessage: params.userMessage,
        memoryDigest: params.memoryDigest,
        conversationCoverageDigest: params.conversationCoverageDigest,
        llm: params.llm,
    });
    return result.task === "reply"
        ? result.message
        : "我先说结论：你这个问题还得继续收敛。你再补一句，你现在最想解决的是方向选择，还是下一场面试怎么提升？";
}
async function generateConsultSummary(params) {
    const result = await (0, langgraphAgent_1.runConsultAgent)({
        task: "summary",
        records: params.records,
        goal: params.goal,
        messages: params.messages,
        memoryDigest: params.memoryDigest,
        conversationCoverageDigest: params.conversationCoverageDigest,
        llm: params.llm,
    });
    if (result.task !== "summary") {
        return {
            summary: fallbackSummary(),
            closingMessage: fallbackClosingMessage(),
        };
    }
    return {
        summary: result.summary,
        closingMessage: result.closingMessage,
    };
}
function fallbackOpening(records) {
    if (!records[0])
        return "我先说结论：你现在缺的不是建议，是先把真实面试记录跑起来。";
    return `我先说结论：这次复盘不能只看单句回答，要看你在 ${records.length} 场面试里反复暴露的问题。你先回答我一个问题：你现在最想解决的是岗位方向，还是下一场面试怎么提分？`;
}
function fallbackSummary() {
    return {
        currentJudgement: "你当前最需要解决的是目标聚焦和回答证据链问题。",
        primaryTarget: "继续围绕当前得分更稳定的岗位方向训练",
        notRecommended: ["短期内不要同时分散准备太多方向"],
        repeatedIssues: ["项目回答缺少难点、行动和结果"],
        nextPracticeFocus: ["优先练项目深挖和岗位动机"],
        sevenDayPlan: ["整理历史面试问题", "重写一个核心项目回答", "再完成一次针对性模拟"],
    };
}
function fallbackClosingMessage() {
    return "我直接说，方向别再散了。你现在不是没机会，是主线还不够清楚。先把一条线练扎实，把项目讲透，把岗位动机说硬。比你同时试三条路强得多。";
}
