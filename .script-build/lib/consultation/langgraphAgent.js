"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runConsultAgent = runConsultAgent;
const langgraph_1 = require("@langchain/langgraph");
const llm_1 = require("../llm");
const zhangxuefengSkills_1 = require("./zhangxuefengSkills");
const ConsultGraphState = langgraph_1.Annotation.Root({
    task: (langgraph_1.Annotation),
    records: (0, langgraph_1.Annotation)({
        reducer: (_left, right) => right,
        default: () => [],
    }),
    goal: (langgraph_1.Annotation),
    messages: (0, langgraph_1.Annotation)({
        reducer: (_left, right) => right,
        default: () => [],
    }),
    userMessage: (0, langgraph_1.Annotation)({
        reducer: (_left, right) => right,
        default: () => "",
    }),
    memoryDigest: (0, langgraph_1.Annotation)({
        reducer: (_left, right) => right,
        default: () => "",
    }),
    conversationCoverageDigest: (0, langgraph_1.Annotation)({
        reducer: (_left, right) => right,
        default: () => "",
    }),
    llm: (0, langgraph_1.Annotation)({
        reducer: (_left, right) => right,
        default: () => undefined,
    }),
    selectedSkills: (0, langgraph_1.Annotation)({
        reducer: (_left, right) => right,
        default: () => [],
    }),
    skillPrompt: (0, langgraph_1.Annotation)({
        reducer: (_left, right) => right,
        default: () => "",
    }),
    message: (0, langgraph_1.Annotation)({
        reducer: (_left, right) => right,
        default: () => undefined,
    }),
    summary: (0, langgraph_1.Annotation)({
        reducer: (_left, right) => right,
        default: () => undefined,
    }),
    closingMessage: (0, langgraph_1.Annotation)({
        reducer: (_left, right) => right,
        default: () => undefined,
    }),
});
const consultGraph = new langgraph_1.StateGraph(ConsultGraphState)
    .addNode("select_skills", selectSkillsNode)
    .addNode("generate", generateNode)
    .addEdge(langgraph_1.START, "select_skills")
    .addEdge("select_skills", "generate")
    .addEdge("generate", langgraph_1.END)
    .compile();
async function runConsultAgent(input) {
    const result = await consultGraph.invoke({
        task: input.task,
        records: input.records,
        goal: input.goal,
        messages: input.messages ?? [],
        userMessage: input.userMessage ?? "",
        memoryDigest: input.memoryDigest ?? "",
        conversationCoverageDigest: input.conversationCoverageDigest ?? "",
        llm: input.llm,
    });
    if (input.task === "summary") {
        return {
            task: "summary",
            summary: result.summary ?? fallbackSummary(),
            closingMessage: result.closingMessage ?? fallbackClosingMessage(),
            selectedSkills: result.selectedSkills,
        };
    }
    return {
        task: input.task,
        message: result.message?.trim() || fallbackOpening(input.records),
        selectedSkills: result.selectedSkills,
    };
}
function selectSkillsNode(state) {
    const selectedSkills = (0, zhangxuefengSkills_1.selectZhangXuefengSkills)({
        records: state.records,
        goal: state.goal,
        userMessage: state.userMessage,
        conversationCoverageDigest: state.conversationCoverageDigest,
    });
    return {
        selectedSkills,
        skillPrompt: (0, zhangxuefengSkills_1.buildZhangXuefengSkillPrompt)(selectedSkills),
    };
}
async function generateNode(state) {
    if (state.task === "summary") {
        const raw = await (0, llm_1.getLLM)(state.llm).completeJSON({
            system: consultSystemPrompt(state.skillPrompt),
            messages: [{ role: "user", content: buildSummaryPrompt(state) }],
        });
        const summary = {
            currentJudgement: asText(raw.currentJudgement, "你当前最需要解决的是目标聚焦和回答证据链问题。"),
            primaryTarget: asText(raw.primaryTarget, "继续围绕当前得分更稳定的岗位方向训练"),
            notRecommended: asTextArray(raw.notRecommended, ["短期内不要同时分散准备太多方向"]),
            repeatedIssues: asTextArray(raw.repeatedIssues, ["项目回答缺少难点、行动和结果"]),
            nextPracticeFocus: asTextArray(raw.nextPracticeFocus, ["优先练项目深挖和岗位动机"]),
            sevenDayPlan: asTextArray(raw.sevenDayPlan, ["整理历史面试问题", "重写一个核心项目回答", "再完成一次针对性模拟"]),
        };
        return {
            summary,
            closingMessage: asText(raw.closingMessage, fallbackClosingMessage()),
        };
    }
    const raw = await (0, llm_1.getLLM)(state.llm).completeJSON({
        system: consultSystemPrompt(state.skillPrompt),
        messages: [{ role: "user", content: state.task === "opening" ? buildOpeningPrompt(state) : buildReplyPrompt(state) }],
    });
    return {
        message: raw.message?.trim() || fallbackOpening(state.records),
    };
}
function consultSystemPrompt(skillPrompt) {
    return `你是一名“张雪峰式”的 AI 求职战略咨询师，正在基于用户历史模拟面试记录做一对一职业战略咨询。

重要边界：
- 你可以使用公开表达风格和思维框架，但不要声称自己是真实张雪峰本人，也不要声称本人授权。
- 不输出角色扮演免责声明，直接以“张雪峰式咨询师”的语气进入咨询。
- 可以直接、犀利、口语化，但不能羞辱用户，不能使用粗俗攻击。
- 每次指出问题后，必须给一个可执行改法。

${skillPrompt}

工作要求：
- 复盘必须引用历史面试里的具体证据，例如岗位、分数、维度短板、回答问题。
- 这是连续对话，不是一次性报告。除最终总结外，每轮结尾优先追问 1-3 个关键问题或给下一步选择。
- 如果历史记忆里某些背景、建议、问题已经明确，除非用户明显变化，否则不要原样重复追问。
- 输出必须是合法 JSON，不要输出 markdown。`;
}
function buildOpeningPrompt(state) {
    return `请基于以下历史面试记录，输出第一轮战略咨询开场诊断。
这不是写报告，是像直播连麦一样和用户说话。
要求：先用一句很口语的判断开场，再引用历史证据，最后追问 1-3 个关键问题。
不要写“当前总体判断/改进建议如下”这种报告腔。
只输出 JSON：{"message":"..."}。

【历史战略咨询记忆】
${state.memoryDigest || "暂无历史战略咨询记忆。"}

${recordsDigest(state.records)}

【本次战略咨询目标】${goalLabel(state.goal)}`;
}
function buildReplyPrompt(state) {
    return `你正在和用户进行一对一职业战略咨询对话。
请结合历史面试记录和当前对话继续诊断，不要闲聊。
注意：这是“张雪峰式连麦”，不是写咨询报告。
每轮要像真人讲话：短句、有停顿、有反问、有情绪起伏。
如果已经足够明确，可以给阶段性判断和下一步训练建议。
每轮最多追问 1-3 个关键问题。
只输出 JSON：{"message":"..."}。

【历史战略咨询记忆】
${state.memoryDigest || "暂无历史战略咨询记忆。"}

【当前会话已覆盖内容】
${state.conversationCoverageDigest || "当前会话刚开始。"}

【历史面试记录】
${recordsDigest(state.records)}

【本次战略咨询目标】${goalLabel(state.goal)}

【当前对话】
${messagesDigest(state.messages)}

【用户最新回复】
${state.userMessage}`;
}
function buildSummaryPrompt(state) {
    return `用户已经结束本次战略咨询对话。请基于历史面试和本次对话生成最终咨询结论。只输出 JSON，字段必须为：
{
  "currentJudgement": "当前总体判断",
  "primaryTarget": "建议主攻方向",
  "notRecommended": ["暂不建议方向"],
  "repeatedIssues": ["反复出现的问题"],
  "nextPracticeFocus": ["下一场面试训练重点"],
  "sevenDayPlan": ["未来7天行动计划"],
  "closingMessage": "用张雪峰式口吻给用户的一段简短收尾"
}

注意：
- summary 字段可以结构化，但 closingMessage 必须像真人最后叮嘱，不要像报告结语。
- closingMessage 控制在 120-220 字，短句，有停顿，有情绪。
- closingMessage 要先给一句明确判断，再给一句提醒，最后给下一步动作。
- 不要说“综上所述”“建议如下”“本次咨询总结为”。

【历史战略咨询记忆】
${state.memoryDigest || "暂无历史战略咨询记忆。"}

【当前会话已覆盖内容】
${state.conversationCoverageDigest || "当前会话刚开始。"}

【历史面试记录】
${recordsDigest(state.records)}

【本次战略咨询目标】${goalLabel(state.goal)}

【完整对话】
${messagesDigest(state.messages)}`;
}
function recordsDigest(records) {
    return records
        .map((record, index) => {
        const scores = record.report.dimensionScores;
        const scoreText = scores
            ? Object.entries(scores)
                .map(([key, value]) => `${key}:${value}`)
                .join("、")
            : "";
        const weaknesses = record.report.weaknesses?.slice(0, 3).join("；") || "暂无";
        const strengths = record.report.strengths?.slice(0, 2).join("；") || "暂无";
        const sampleRounds = record.rounds
            .slice(0, 3)
            .map((round, roundIndex) => `Q${roundIndex + 1}:${round.question}\nA${roundIndex + 1}:${round.answer.slice(0, 260)}`)
            .join("\n");
        return `【记录${index + 1}】${record.company} · ${record.jobTitle}
综合分数：${record.report.overallBand}/9
五维分数：${scoreText}
优势：${strengths}
短板：${weaknesses}
部分问答：
${sampleRounds}`;
    })
        .join("\n\n");
}
function messagesDigest(messages) {
    return messages
        .slice(-10)
        .map((message) => `${message.role === "assistant" ? "AI" : "用户"}：${message.content}`)
        .join("\n\n");
}
function goalLabel(goal) {
    if (goal === "direction_judgement")
        return "判断岗位方向";
    if (goal === "practice_plan")
        return "制定下一步练习计划";
    if (goal === "single_review")
        return "复盘单场表现";
    return "找共性问题";
}
function fallbackOpening(records) {
    const first = records[0];
    if (!first)
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
function asText(value, fallback) {
    return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
function asTextArray(value, fallback) {
    if (!Array.isArray(value))
        return fallback;
    const items = value.filter((item) => typeof item === "string" && !!item.trim());
    return items.length ? items.slice(0, 6) : fallback;
}
