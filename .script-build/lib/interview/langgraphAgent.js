"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runInterviewAgent = runInterviewAgent;
const langgraph_1 = require("@langchain/langgraph");
const llm_1 = require("../llm");
const personas_1 = require("../personas");
const endDetection_1 = require("./endDetection");
const TYPE_GUARDRAILS = {
    hr: "本场是 HR 面。后续问题只能围绕职业动机、稳定性、价值观、团队协作、文化匹配、入职意愿等 HR 主题，不要追问技术细节。",
    technical: "本场是技术面。后续问题应围绕技术基础、项目技术细节、工程实践、系统设计、问题定位等主题。",
    behavioral: "本场是行为面。后续问题必须围绕真实经历、团队协作、冲突处理、压力情境、失败复盘、沟通方式、决策偏好等行为事件，不要追问技术实现细节。",
    mixed: "本场是综合面。可以混合 HR、技术、行为问题，但必须贴合简历与 JD。",
};
const MAX_FOLLOWUPS_BY_DIFFICULTY = {
    easy: 1,
    medium: 2,
    hard: 3,
    realistic: 5,
};
const InterviewGraphState = langgraph_1.Annotation.Root({
    session: (langgraph_1.Annotation),
    analysis: (0, langgraph_1.Annotation)({
        reducer: (_left, right) => right,
        default: () => undefined,
    }),
    strategy: (0, langgraph_1.Annotation)({
        reducer: (_left, right) => right,
        default: () => undefined,
    }),
    candidate: (0, langgraph_1.Annotation)({
        reducer: (_left, right) => right,
        default: () => undefined,
    }),
    nextAction: (0, langgraph_1.Annotation)({
        reducer: (_left, right) => right,
        default: () => undefined,
    }),
});
const interviewGraph = new langgraph_1.StateGraph(InterviewGraphState)
    .addNode("analyze", analyzeNode)
    .addNode("plan_strategy", planStrategyNode)
    .addNode("generate_question", generateQuestionNode)
    .addNode("validate", validateNode)
    .addEdge(langgraph_1.START, "analyze")
    .addEdge("analyze", "plan_strategy")
    .addEdge("plan_strategy", "generate_question")
    .addEdge("generate_question", "validate")
    .addEdge("validate", langgraph_1.END)
    .compile();
async function runInterviewAgent(session) {
    const result = await interviewGraph.invoke({ session });
    return result.nextAction ?? fallbackNextAction(analyzeSession(session), "LangGraph 未返回有效下一题");
}
function analyzeNode(state) {
    return { analysis: analyzeSession(state.session) };
}
function planStrategyNode(state) {
    const analysis = state.analysis ?? analyzeSession(state.session);
    const strategy = planInterviewStrategy(analysis);
    return { strategy };
}
async function generateQuestionNode(state) {
    const session = state.session;
    const analysis = state.analysis ?? analyzeSession(session);
    const strategy = state.strategy ?? planInterviewStrategy(analysis);
    const llm = {
        provider: session.provider,
        model: session.model,
        thinkingEnabled: session.thinkingEnabled,
    };
    const p = (0, personas_1.findPersona)(session.persona);
    const d = (0, personas_1.findDifficulty)(session.difficulty);
    const system = `${p.styleHint}

${d.hint}

${TYPE_GUARDRAILS[session.interviewType]}

你是一个 LangGraph 面试 Agent 中的“下一题生成节点”。
必须服从上游策略控制节点的 action 限制，不要为了追问而牺牲整场覆盖面。
请以 ${analysis.languageLabel} 提问，语言风格要与面试官人格一致。
严格只输出 JSON。`;
    const userContent = `【目标公司】${session.company}
【目标岗位】${session.jobTitle}
【面试类型】${session.interviewType}
【考察重点】${session.plan?.focusAreas.join("、") || "暂无"}

【计划问题清单】
${session.plan?.plannedQuestions.map((q, i) => `${i + 1}. ${q}`).join("\n") || "暂无"}

【未覆盖计划问题】
${analysis.uncoveredPlannedQuestions.map((q, i) => `${i + 1}. ${q}`).join("\n") || "暂无"}

【已进行轮次】
${analysis.history || "暂无"}

【历史已问问题清单】
${analysis.previousQuestions.map((question, index) => `${index + 1}. ${question}`).join("\n") || "暂无"}

【节奏状态】
- 当前轮次数：${analysis.roundCount}
- 剩余可问轮次：${analysis.remainingRounds}
- 当前连续追问次数：${analysis.consecutiveFollowUps}
- 当前难度允许连续追问上限：${analysis.maxConsecutiveFollowUps}
- 总轮次上限：${analysis.maxRounds}
- 节奏策略：${analysis.usesAdaptiveDepth ? "真实难度自适应深挖" : "固定覆盖目标"}
- ${analysis.usesAdaptiveDepth ? `当前覆盖压力：${coveragePressureLabel(analysis.adaptiveCoveragePressure)}` : `最低主问题覆盖目标：${analysis.targetMainQuestions}`}
- 已覆盖计划问题数：${analysis.coveredPlannedQuestions}
- 用户最新回答是否为空/未作答：${analysis.latestAnswerIsEmpty ? "是" : "否"}

【策略控制节点输出】
- 允许 action：${strategy.allowedActions.join(" / ")}
- 强制 action：${strategy.forcedAction || "无"}
- 策略说明：${strategy.instruction}

重要约束：
- 下一题不得与【历史已问问题清单】中的任何问题一字不差重复。
- 如果用户上一题跑偏，可以换一种更具体的问法重新拉回主题，但不能原句重复。
- 如果无法提出新的有效追问，应切到下一个计划主题。

请输出 JSON：
{
  "action": "followup" | "next" | "end",
  "question": "如果 action 是 followup 或 next，给出下一句要对候选人说的话；如果 action 是 end，给一句自然收尾",
  "rationale": "简短说明为什么这样安排节奏"
}`;
    const candidate = await (0, llm_1.getLLM)(llm).completeJSON({
        system,
        messages: [{ role: "user", content: userContent }],
        thinkingEnabled: llm.thinkingEnabled,
    });
    return { candidate };
}
function validateNode(state) {
    const session = state.session;
    const analysis = state.analysis ?? analyzeSession(session);
    const strategy = state.strategy ?? planInterviewStrategy(analysis);
    const candidate = normalizeCandidate(state.candidate);
    let action = candidate.action;
    if (strategy.forcedAction && action !== strategy.forcedAction) {
        action = strategy.forcedAction;
    }
    if (!strategy.allowedActions.includes(action)) {
        action = strategy.allowedActions[0] ?? "next";
    }
    if (action === "followup" && analysis.consecutiveFollowUps >= analysis.maxConsecutiveFollowUps) {
        action = "next";
    }
    const candidateQuestion = cleanQuestion(candidate.question);
    if ((0, endDetection_1.isClosingInterviewPrompt)(candidateQuestion)) {
        action = "end";
    }
    const repeatedQuestion = isRepeatedQuestion(candidateQuestion, analysis.previousQuestions);
    let question = candidateQuestion || fallbackQuestionForAction(action, analysis);
    if (repeatedQuestion) {
        action = action === "end" ? "end" : "next";
        question = fallbackQuestionForAction(action, analysis);
    }
    return {
        nextAction: {
            action,
            question,
            rationale: repeatedQuestion ? "候选问题与历史问题重复，已切换到新的主题。" : candidate.rationale || strategy.rationale,
        },
    };
}
function analyzeSession(session) {
    const rounds = session.rounds;
    const maxRounds = (0, personas_1.getMaxInterviewRounds)(session.difficulty);
    const consecutiveFollowUps = countTrailingFollowUps(rounds);
    const mainQuestionsAsked = rounds.filter((round) => !round.isFollowUp).length;
    const plannedQuestions = session.plan?.plannedQuestions ?? [];
    // openingQuestion is separate from plannedQuestions, so the first non-follow-up round is the opening.
    const coveredPlannedQuestions = Math.max(0, mainQuestionsAsked - 1);
    const uncoveredPlannedQuestions = plannedQuestions.slice(coveredPlannedQuestions);
    const latestAnswer = rounds[rounds.length - 1]?.answer.trim() ?? "";
    const previousQuestions = rounds.map((round) => round.question).filter(Boolean);
    const suggestedNextQuestion = findFirstNonRepeatedQuestion(uncoveredPlannedQuestions, previousQuestions) ||
        fallbackGenericQuestion(session);
    return {
        languageLabel: session.language === "zh" ? "中文" : "English",
        history: rounds
            .map((round, index) => `第${index + 1}轮${round.isFollowUp ? "(追问)" : ""}：\nQ: ${round.question}\nA: ${round.answer}`)
            .join("\n\n"),
        roundCount: rounds.length,
        remainingRounds: Math.max(0, maxRounds - rounds.length),
        consecutiveFollowUps,
        maxConsecutiveFollowUps: MAX_FOLLOWUPS_BY_DIFFICULTY[session.difficulty],
        mainQuestionsAsked,
        targetMainQuestions: targetMainQuestionsForDifficulty(session.difficulty),
        adaptiveCoveragePressure: getAdaptiveCoveragePressure({
            roundCount: rounds.length,
            remainingRounds: Math.max(0, maxRounds - rounds.length),
            mainQuestionsAsked,
            uncoveredPlannedQuestions,
        }),
        coveredPlannedQuestions,
        uncoveredPlannedQuestions,
        previousQuestions,
        latestAnswerIsEmpty: isEmptyAnswer(latestAnswer),
        suggestedNextQuestion,
        maxRounds,
        usesAdaptiveDepth: session.difficulty === "realistic",
    };
}
function planInterviewStrategy(analysis) {
    if (analysis.remainingRounds <= 0) {
        return {
            forcedAction: "end",
            allowedActions: ["end"],
            instruction: "总轮次已经用完，必须结束面试。",
            rationale: "达到总轮次上限",
        };
    }
    if (analysis.latestAnswerIsEmpty) {
        return {
            forcedAction: "next",
            allowedActions: ["next"],
            instruction: "用户最新回答为空或未作答，不要继续围绕空回答追问，直接切到下一个计划主题。",
            rationale: "避免对无内容回答连续追问",
        };
    }
    if (analysis.consecutiveFollowUps >= analysis.maxConsecutiveFollowUps) {
        return {
            forcedAction: "next",
            allowedActions: ["next"],
            instruction: "当前主题连续追问已达到本难度上限，必须切到下一个计划主题。",
            rationale: "达到连续追问上限",
        };
    }
    if (!analysis.usesAdaptiveDepth && analysis.targetMainQuestions !== null) {
        const remainingMainQuestionsNeeded = Math.max(0, analysis.targetMainQuestions - analysis.mainQuestionsAsked);
        if (analysis.uncoveredPlannedQuestions.length > 0 && analysis.remainingRounds <= remainingMainQuestionsNeeded) {
            return {
                forcedAction: "next",
                allowedActions: ["next"],
                instruction: "剩余轮次数刚好只够覆盖最低主问题数量，必须优先切换到下一个计划主题，不要追问。",
                rationale: "优先保证最低主题覆盖面",
            };
        }
    }
    if (analysis.usesAdaptiveDepth && analysis.adaptiveCoveragePressure === "high") {
        return {
            forcedAction: "next",
            allowedActions: ["next"],
            instruction: "当前覆盖面明显不足且剩余轮次已经不多，必须切到下一个主问题，不要继续深挖当前主题。",
            rationale: "覆盖压力过高，优先补足面试广度",
        };
    }
    const allowEnd = analysis.roundCount >= minimumRoundsBeforeEnd(analysis.maxRounds, analysis.usesAdaptiveDepth);
    return {
        allowedActions: allowEnd ? ["followup", "next", "end"] : ["followup", "next"],
        instruction: analysis.usesAdaptiveDepth
            ? `真实难度下，请根据当前总轮次、剩余轮次、主问题覆盖和候选人回答质量自适应判断。覆盖压力为 ${coveragePressureLabel(analysis.adaptiveCoveragePressure)}。如果最新回答有信息密度、关键漏洞、可验证经历或岗位相关细节，允许继续深挖；如果回答已经足够清楚或当前主题收益下降，应切到下一个计划主题。只有在已经覆盖足够、追问收益下降、剩余问题没有明显必要时才允许结束。`
            : "普通难度下，请在固定覆盖目标内平衡深挖和广度。如果最新回答有明显漏洞、缺少例子或缺少量化，可以追问；如果当前主题已经足够清楚，应切到下一个计划主题。不要过早结束，除非候选人明确要求结束或不想继续。",
        rationale: analysis.usesAdaptiveDepth
            ? "真实难度由 Agent 根据深挖收益、覆盖面和剩余轮次自适应决策"
            : "普通难度在固定覆盖目标下平衡追问与覆盖面",
    };
}
function normalizeCandidate(candidate) {
    const action = candidate?.action === "followup" || candidate?.action === "next" || candidate?.action === "end"
        ? candidate.action
        : "next";
    return {
        action,
        question: typeof candidate?.question === "string" ? candidate.question : "",
        rationale: typeof candidate?.rationale === "string" ? candidate.rationale : undefined,
    };
}
function countTrailingFollowUps(rounds) {
    let count = 0;
    for (let index = rounds.length - 1; index >= 0; index -= 1) {
        if (!rounds[index].isFollowUp)
            break;
        count += 1;
    }
    return count;
}
function isEmptyAnswer(answer) {
    const normalized = answer.trim().toLowerCase();
    if (!normalized)
        return true;
    return [
        "未作答",
        "未在倒计时内作答",
        "no answer",
        "no answer provided",
    ].some((item) => normalized.includes(item));
}
function cleanQuestion(question) {
    return question.trim().replace(/^["“]|["”]$/g, "").trim();
}
function isRepeatedQuestion(question, previousQuestions) {
    const normalized = normalizeQuestionForComparison(question);
    if (!normalized)
        return false;
    return previousQuestions.some((previous) => {
        const normalizedPrevious = normalizeQuestionForComparison(previous);
        if (!normalizedPrevious)
            return false;
        if (normalized === normalizedPrevious)
            return true;
        return questionSimilarity(normalized, normalizedPrevious) >= 0.92;
    });
}
function normalizeQuestionForComparison(question) {
    return question
        .toLowerCase()
        .replace(/[“”"'.?？!！,，。；;：:\s]/g, "")
        .replace(/^(请问|那么|那|所以|好的|好|接下来|继续)/, "")
        .trim();
}
function questionSimilarity(left, right) {
    if (!left || !right)
        return 0;
    const longer = left.length >= right.length ? left : right;
    const shorter = left.length >= right.length ? right : left;
    if (!longer.length)
        return 1;
    const distance = levenshteinDistance(longer, shorter);
    return 1 - distance / longer.length;
}
function levenshteinDistance(left, right) {
    const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
    const current = Array(right.length + 1).fill(0);
    for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
        current[0] = leftIndex;
        for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
            const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
            current[rightIndex] = Math.min(current[rightIndex - 1] + 1, previous[rightIndex] + 1, previous[rightIndex - 1] + substitutionCost);
        }
        for (let index = 0; index < previous.length; index += 1) {
            previous[index] = current[index];
        }
    }
    return previous[right.length];
}
function fallbackQuestionForAction(action, analysis) {
    if (action === "end") {
        return analysis.languageLabel === "中文"
            ? "好的，本轮面试先到这里。"
            : "Thanks, we can stop here for this interview.";
    }
    return analysis.suggestedNextQuestion;
}
function findFirstNonRepeatedQuestion(questions, previousQuestions) {
    return questions.find((question) => !isRepeatedQuestion(question, previousQuestions)) ?? null;
}
function fallbackNextAction(analysis, rationale) {
    const action = analysis.remainingRounds <= 0 ? "end" : "next";
    return {
        action,
        question: fallbackQuestionForAction(action, analysis),
        rationale,
    };
}
function fallbackGenericQuestion(session) {
    if (session.language === "en") {
        return `Please pick one experience that is most relevant to ${session.jobTitle} and explain your role, actions, and result.`;
    }
    if (session.interviewType === "behavioral") {
        return "请再讲一个你在团队协作或冲突处理中的真实经历，重点说明当时的情境、你的行动和最后结果。";
    }
    if (session.interviewType === "hr") {
        return `请结合你的经历，说明你为什么选择${session.company}的${session.jobTitle}岗位。`;
    }
    if (session.interviewType === "technical") {
        return "请挑一个你最熟悉的项目，具体讲讲其中一个关键技术难点，以及你是怎么解决的。";
    }
    return `请结合你的简历，讲一个最能证明你适合${session.jobTitle}岗位的经历。`;
}
function minimumRoundsBeforeEnd(maxRounds, usesAdaptiveDepth) {
    return usesAdaptiveDepth ? Math.min(6, maxRounds - 1) : Math.min(5, maxRounds - 1);
}
function targetMainQuestionsForDifficulty(difficulty) {
    if (difficulty === "realistic")
        return null;
    if (difficulty === "hard")
        return 4;
    return 5;
}
function getAdaptiveCoveragePressure(params) {
    if (!params.uncoveredPlannedQuestions.length)
        return "low";
    if (params.roundCount < 3)
        return "low";
    if (params.remainingRounds <= 2 && params.mainQuestionsAsked <= 2)
        return "high";
    if (params.remainingRounds <= 3 && params.mainQuestionsAsked <= 3)
        return "medium";
    return "low";
}
function coveragePressureLabel(pressure) {
    if (pressure === "high")
        return "高，需要优先切换主题补足覆盖面";
    if (pressure === "medium")
        return "中，需要谨慎权衡深挖与切题";
    return "低，可以根据回答质量自适应深挖";
}
