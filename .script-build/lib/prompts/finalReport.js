"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateReport = generateReport;
const llm_1 = require("../llm");
const types_1 = require("../types");
const personas_1 = require("../personas");
async function generateReport(session) {
    const llm = {
        provider: session.provider,
        model: session.model,
        thinkingEnabled: session.thinkingEnabled,
    };
    if (session.interviewType === "behavioral") {
        return generateBehavioralMbtiReport(session);
    }
    const { resume, company, jobTitle, jd, plan, rounds, language, persona, difficulty } = session;
    const lang = language === "zh" ? "中文" : "English";
    const languageRule = reportLanguageRule(language);
    const p = (0, personas_1.findPersona)(persona);
    const d = (0, personas_1.findDifficulty)(difficulty);
    const system = `你是一名资深面试评估专家。

本场面试的面试官人格是「${p.label}」（${p.description}），难度档位是「${d.label}」（${d.description}）。评估时请把这个上下文考虑进去：难度越高，对回答完整度和专业度的期望也越高；人格不同，考察侧重也不同。

请针对候选人整场面试表现给出结构化、具体、可执行的反馈。严格以 ${lang} 输出。避免空泛表述，务必引用候选人实际回答内容。
${languageRule}

评分体系要求：
- 使用 0-9 的 Band 制评分
- 每个分数只能是 0.5 的倍数
- 只评估 5 个维度：岗位匹配度、回答完整度、逻辑性、专业度、沟通表达
- 不要输出“数据化表达”维度
- 数据、指标、量化成果只能作为“回答完整度 / 逻辑性 / 专业度”的加分证据，不能单独成维度
- 不要输出总分，系统会在后端按固定权重计算综合 Band
- 所有字符串数组中的每一项都必须是双引号包裹的合法 JSON 字符串，绝对不要出现未加双引号的中文句子`;
    const history = rounds
        .map((r, i) => `Round ${i + 1}${r.isFollowUp ? " (followup)" : ""}${r.timedOut ? " (timed out)" : ""}
Q: ${r.question}
A: ${r.answer}`)
        .join("\n\n");
    const userContent = `【公司】${company}  【岗位】${jobTitle}
【JD 摘要】${jd.slice(0, 800)}
【简历摘要】${resume.slice(0, 1200)}
【本场考察重点】${plan?.focusAreas.join("、") ?? ""}

【完整面试记录】
${history}

请输出 JSON：
{
  "dimensionScores": {
    "岗位匹配度": 0-9 且只能是 0.5 的倍数,
    "回答完整度": 0-9 且只能是 0.5 的倍数,
    "逻辑性": 0-9 且只能是 0.5 的倍数,
    "专业度": 0-9 且只能是 0.5 的倍数,
    "沟通表达": 0-9 且只能是 0.5 的倍数
  },
  "dimensionDetails": {
    "岗位匹配度": {
      "score": 与上面一致,
      "evidence": [${language === "en" ? "\"1-3 evidence points in English; quote the candidate only when necessary\"" : "\"1~3 条证据，引用候选人实际回答或明确指出缺失了什么证据\""}],
      "reason": "${language === "en" ? "one scoring reason in English" : "1 句评分理由"}",
      "advice": "${language === "en" ? "one actionable improvement suggestion in English" : "1 句改进建议"}"
    },
    "回答完整度": { "score": 与上面一致, "evidence": [], "reason": "", "advice": "" },
    "逻辑性": { "score": 与上面一致, "evidence": [], "reason": "", "advice": "" },
    "专业度": { "score": 与上面一致, "evidence": [], "reason": "", "advice": "" },
    "沟通表达": { "score": 与上面一致, "evidence": [], "reason": "", "advice": "" }
  },
  "strengths": [${language === "en" ? "\"3-5 specific strengths in English\"" : "\"3~5 条具体的亮点，引用候选人实际回答\""}],
  "weaknesses": [${language === "en" ? "\"3-5 specific weaknesses in English\"" : "\"3~5 条具体的短板，指出哪些回答存在的问题\""}],
  "improvementAdvice": [${language === "en" ? "\"3-5 actionable suggestions in English\"" : "\"3~5 条可执行的改进建议\""}],
  "betterAnswers": [
    { "question": "${language === "en" ? "original question text for 2-3 weaker answers" : "挑 2~3 个候选人答得不够好的问题原文"}", "suggested": "${language === "en" ? "a stronger sample answer in English, tailored to the resume and JD" : "给出一个更好的回答范例（贴合候选人简历和 JD）"}" }
  ]
}`;
    const raw = await (0, llm_1.getLLM)(llm).completeJSON({
        system,
        messages: [{ role: "user", content: userContent }],
        thinkingEnabled: llm.thinkingEnabled,
    });
    return normalizeReport(raw, session);
}
async function generateBehavioralMbtiReport(session) {
    const llm = {
        provider: session.provider,
        model: session.model,
        thinkingEnabled: session.thinkingEnabled,
    };
    const { resume, company, jobTitle, jd, plan, rounds, language, persona, difficulty } = session;
    const lang = language === "zh" ? "中文" : "English";
    const languageRule = reportLanguageRule(language);
    const p = (0, personas_1.findPersona)(persona);
    const d = (0, personas_1.findDifficulty)(difficulty);
    const system = `你是一名行为面试评估专家，擅长从候选人在行为面中的表达、决策、协作和压力反应里判断 MBTI 风格倾向。

本场面试的面试官人格是「${p.label}」（${p.description}），难度档位是「${d.label}」（${d.description}）。

请注意：
- 这是行为面试专属报告，不要输出传统五维评分。
- MBTI 结果直接给 4 个字母，例如 ESTJ、INFP。
- 结论只代表“本次面试语境下的行为表达倾向”，不要声称是真实人格定型。
- 如果证据不足，也要给出当前最接近的类型，但 confidence 要降低。
- 每个维度必须引用候选人回答中的具体语言特征或行为证据。
- strengths 和 risks 必须结合【目标岗位 / JD】判断“用户行为性格与岗位要求的匹配度”，不要只写泛泛的人格优缺点。
- strengths 要回答：用户的行为倾向为什么适合这个岗位，能在哪些岗位任务中形成优势。
- risks 要回答：用户的行为倾向在这个岗位里可能在哪些场景拖后腿，或与岗位要求产生冲突。
- 每条 strengths / risks 都必须同时包含“用户回答中的性格证据”和“岗位场景影响”。
- 严格以 ${lang} 输出。
${languageRule}
- 只输出合法 JSON，所有中文句子必须放在双引号中。`;
    const history = rounds
        .map((round, index) => `Round ${index + 1}${round.isFollowUp ? " (followup)" : ""}${round.timedOut ? " (timed out)" : ""}
Q: ${round.question}
A: ${round.answer}`)
        .join("\n\n");
    const userContent = `【公司】${company}  【岗位】${jobTitle}
【JD 摘要】${jd.slice(0, 800)}
【简历摘要】${resume.slice(0, 1200)}
【本场考察重点】${plan?.focusAreas.join("、") ?? ""}

【完整行为面试记录】
${history}

请输出 JSON：
{
  "mbtiType": "ESTJ / INFP 等 4 字母结果",
  "confidence": 0-100 的整数，表示本次面试语境下的倾向置信度,
  "summary": "${language === "en" ? "2-3 English sentences summarizing the candidate's behavioral style" : "用 2-3 句话概括候选人的行为风格画像"}",
  "axes": {
    "EI": {
      "selected": "E 或 I",
      "tendency": 0-100 的整数，表示向 selected 一侧倾斜的程度,
      "evidence": [${language === "en" ? "\"1-2 evidence points in English; quote the candidate only when necessary\"" : "\"1~2 条候选人回答里的证据\""}],
      "reason": "${language === "en" ? "one English reason for the judgement" : "1 句判断理由"}"
    },
    "SN": { "selected": "S 或 N", "tendency": 0-100, "evidence": [], "reason": "" },
    "TF": { "selected": "T 或 F", "tendency": 0-100, "evidence": [], "reason": "" },
    "JP": { "selected": "J 或 P", "tendency": 0-100, "evidence": [], "reason": "" }
  },
  "strengths": [${language === "en" ? "\"3-5 English strengths connecting behavioral evidence with job scenarios\"" : "\"3~5 条用户行为性格与目标岗位匹配的优势，每条都要结合回答证据和岗位场景\""}],
  "risks": [${language === "en" ? "\"3-5 English risks connecting behavioral evidence with job scenarios\"" : "\"3~5 条用户行为性格与目标岗位可能不匹配或需要注意的风险，每条都要结合回答证据和岗位场景\""}],
  "jobMatches": [${language === "en" ? "\"3-5 English role or team environment suggestions\"" : "\"3~5 条更匹配的岗位 / 团队环境建议\""}]
}`;
    const raw = await (0, llm_1.getLLM)(llm).completeJSON({
        system,
        messages: [{ role: "user", content: userContent }],
        thinkingEnabled: llm.thinkingEnabled,
    });
    const mbtiReport = normalizeMbtiReport(raw, session);
    const emptyScores = Object.fromEntries(types_1.REPORT_DIMENSIONS.map((dimension) => [dimension, 0]));
    return {
        reportKind: "mbti",
        overallBand: 0,
        overallScore: 0,
        rawOverall: 0,
        penalty: 0,
        difficultyAdjustment: 0,
        weights: types_1.REPORT_WEIGHTS,
        dimensionScores: emptyScores,
        categoryScores: emptyScores,
        dimensionDetails: {},
        penalties: [],
        roundReviews: [],
        answerAnnotations: [],
        annotationSummaries: [],
        strengths: mbtiReport.strengths,
        weaknesses: mbtiReport.risks,
        improvementAdvice: mbtiReport.jobMatches,
        betterAnswers: [],
        mbtiReport,
    };
}
function normalizeReport(raw, session) {
    const rawDimensionScores = asRecord(raw.dimensionScores);
    const rawCategoryScores = asRecord(raw.categoryScores);
    const rawDimensionDetails = asRecord(raw.dimensionDetails);
    const presentScores = types_1.REPORT_DIMENSIONS
        .map((dimension) => coerceBand(rawDimensionScores[dimension] ??
        rawCategoryScores[dimension] ??
        asRecord(rawDimensionDetails[dimension]).score))
        .filter((value) => value !== null);
    const fallbackScore = presentScores.length
        ? roundToNearestHalf(presentScores.reduce((sum, value) => sum + value, 0) / presentScores.length)
        : 5;
    const dimensionScores = Object.fromEntries(types_1.REPORT_DIMENSIONS.map((dimension) => [
        dimension,
        coerceBand(rawDimensionScores[dimension] ??
            rawCategoryScores[dimension] ??
            asRecord(rawDimensionDetails[dimension]).score) ?? fallbackScore,
    ]));
    const dimensionDetails = Object.fromEntries(types_1.REPORT_DIMENSIONS.map((dimension) => {
        const source = asRecord(rawDimensionDetails[dimension]);
        return [
            dimension,
            {
                score: dimensionScores[dimension],
                evidence: asStringArray(source.evidence, 3),
                reason: asString(source.reason) ??
                    (session.language === "en"
                        ? `The current performance on ${dimension} is mixed and still has room to improve.`
                        : `该维度表现有一定基础，但仍有明显提升空间。`),
                advice: asString(source.advice) ??
                    (session.language === "en"
                        ? `Use more concrete examples and answer more directly around the interviewer’s question.`
                        : `后续回答时要更直接地回应问题，并补充更具体的例子和细节。`),
            },
        ];
    }));
    const penalties = computePenalties(session);
    const penalty = roundToQuarter(Math.min(penalties.reduce((sum, item) => sum + item.points, 0), 2));
    const rawOverall = roundToTwoDecimals(types_1.REPORT_DIMENSIONS.reduce((sum, dimension) => sum + dimensionScores[dimension] * types_1.REPORT_WEIGHTS[dimension], 0));
    const difficultyAdjustment = computeDifficultyAdjustment(session, rawOverall, penalties);
    const overallBand = clampBand(roundToNearestHalf(rawOverall - penalty + difficultyAdjustment));
    return {
        overallBand,
        overallScore: overallBand,
        rawOverall,
        penalty,
        difficultyAdjustment,
        weights: types_1.REPORT_WEIGHTS,
        dimensionScores,
        categoryScores: dimensionScores,
        dimensionDetails,
        penalties,
        roundReviews: [],
        answerAnnotations: [],
        annotationSummaries: [],
        strengths: asStringArray(raw.strengths, 5),
        weaknesses: asStringArray(raw.weaknesses, 5),
        improvementAdvice: asStringArray(raw.improvementAdvice, 5),
        betterAnswers: asBetterAnswers(raw.betterAnswers),
        mbtiReport: null,
    };
}
function normalizeMbtiReport(raw, session) {
    const rawAxes = asRecord(raw.axes);
    const axes = {
        EI: normalizeMbtiAxis("EI", rawAxes.EI, session),
        SN: normalizeMbtiAxis("SN", rawAxes.SN, session),
        TF: normalizeMbtiAxis("TF", rawAxes.TF, session),
        JP: normalizeMbtiAxis("JP", rawAxes.JP, session),
    };
    const inferredType = `${axes.EI.selected}${axes.SN.selected}${axes.TF.selected}${axes.JP.selected}`;
    const mbtiType = normalizeMbtiType(asString(raw.mbtiType), inferredType);
    return {
        mbtiType,
        confidence: clampPercent(toInteger(raw.confidence) ?? 65),
        summary: asString(raw.summary) ??
            (session.language === "en"
                ? `The candidate currently shows a behavioral interview style closer to ${mbtiType}.`
                : `候选人在本次行为面试中的表达倾向更接近 ${mbtiType}。`),
        axes,
        strengths: withFallback(asStringArray(raw.strengths, 5), session.language === "en"
            ? ["The current behavioral style has usable strengths, but more evidence is needed."]
            : ["当前行为风格有可转化为求职优势的部分，但还需要更多回答证据支撑。"]),
        risks: withFallback(asStringArray(raw.risks, 5), session.language === "en"
            ? ["The current evidence is still limited, so the type judgement should not be over-interpreted."]
            : ["当前证据仍有限，不建议把本次 MBTI 倾向过度绝对化。"]),
        jobMatches: withFallback(asStringArray(raw.jobMatches, 5), session.language === "en"
            ? ["Choose roles where this communication and decision-making style can be demonstrated with concrete examples."]
            : ["建议选择能用具体经历展示沟通方式、决策方式和协作方式的岗位环境。"]),
    };
}
function normalizeMbtiAxis(axis, value, session) {
    const source = asRecord(value);
    const [left, right] = axis.split("");
    const selected = normalizeMbtiLetter(source.selected, left, right);
    return {
        axis,
        left,
        right,
        selected,
        tendency: clampPercent(toInteger(source.tendency) ?? 60),
        evidence: withFallback(asStringArray(source.evidence, 2), session.language === "en"
            ? ["The current interview evidence is not strong enough, so this is a tentative tendency."]
            : ["当前面试证据还不够充分，因此该维度属于暂定倾向。"]),
        reason: asString(source.reason) ??
            (session.language === "en"
                ? `The current answer pattern leans slightly toward ${selected}.`
                : `当前回答表现略微更接近 ${selected} 倾向。`),
    };
}
function normalizeMbtiType(value, fallback) {
    if (!value)
        return fallback;
    const compact = value.toUpperCase().replace(/[^EISNTFJP]/g, "");
    if (/^[EI][SN][TF][JP]$/.test(compact))
        return compact;
    return fallback;
}
function normalizeMbtiLetter(value, left, right) {
    if (typeof value !== "string")
        return left;
    const letter = value.trim().toUpperCase();
    return letter === left || letter === right ? letter : left;
}
function computePenalties(session) {
    const noAnswerTexts = new Set([
        "未作答",
        "未在倒计时内作答",
        "[No answer]",
        "[No answer before timer ended]",
    ]);
    return session.rounds.flatMap((round, index) => {
        const answer = round.answer.trim();
        const compactLength = answer.replace(/\s+/g, "").length;
        const penalties = [];
        if (noAnswerTexts.has(answer)) {
            penalties.push({
                type: "no_answer",
                points: 0.5,
                roundIndex: index + 1,
                reason: session.language === "en"
                    ? `Round ${index + 1} had no effective answer.`
                    : `第 ${index + 1} 轮未提供有效作答。`,
            });
            return penalties;
        }
        if (round.timedOut && compactLength < 30) {
            penalties.push({
                type: "timed_out_short_answer",
                points: 0.25,
                roundIndex: index + 1,
                reason: session.language === "en"
                    ? `Round ${index + 1} timed out and the answer was too short.`
                    : `第 ${index + 1} 轮超时且回答明显过短。`,
            });
        }
        return penalties;
    });
}
function computeDifficultyAdjustment(session, rawOverall, penalties) {
    if (session.difficulty !== "hard")
        return 0;
    const hasPenalty = penalties.length > 0;
    const followupCount = session.rounds.filter((round) => round.isFollowUp).length;
    const hasTimeout = session.rounds.some((round) => round.timedOut);
    if (!hasPenalty && !hasTimeout && followupCount >= 2 && rawOverall >= 7) {
        return 0.5;
    }
    return 0;
}
function asRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value
        : {};
}
function asString(value) {
    return typeof value === "string" && value.trim() ? value.trim() : null;
}
function asStringArray(value, maxItems) {
    if (!Array.isArray(value))
        return [];
    return value
        .map((item) => asString(item))
        .filter((item) => !!item)
        .slice(0, maxItems);
}
function asBetterAnswers(value) {
    if (!Array.isArray(value))
        return [];
    return value
        .map((item) => {
        const obj = asRecord(item);
        const question = asString(obj.question);
        const suggested = asString(obj.suggested);
        if (!question || !suggested)
            return null;
        return { question, suggested };
    })
        .filter((item) => !!item)
        .slice(0, 3);
}
function withFallback(items, fallback) {
    return items.length > 0 ? items : fallback;
}
function reportLanguageRule(language) {
    if (language === "en") {
        return `Language rule:
- All user-facing evaluative text must be English, including evidence, reason, advice, strengths, weaknesses, improvementAdvice, betterAnswers.suggested, MBTI summary, axis reasons, risks, and jobMatches.
- Keep JSON keys and the five internal dimension names exactly as specified; do not translate the keys.
- Candidate quotes may preserve the candidate's original wording, but your explanation around the quote must be English.
- Do not output Chinese commentary, Chinese labels, or Chinese fallback phrases in any user-facing value.`;
    }
    return "语言规则：所有面向用户的评语、建议、解释、优势、短板和推荐回答均使用中文。";
}
function toInteger(value) {
    const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (!Number.isFinite(numeric))
        return null;
    return Math.round(numeric);
}
function coerceBand(value) {
    const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (!Number.isFinite(numeric))
        return null;
    return clampBand(roundToNearestHalf(numeric));
}
function roundToNearestHalf(value) {
    return Math.round(value * 2) / 2;
}
function roundToQuarter(value) {
    return Math.round(value * 4) / 4;
}
function roundToTwoDecimals(value) {
    return Math.round(value * 100) / 100;
}
function clampBand(value) {
    return Math.max(0, Math.min(9, value));
}
function clampPercent(value) {
    return Math.max(0, Math.min(100, Math.round(value)));
}
