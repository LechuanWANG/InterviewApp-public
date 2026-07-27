"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.annotateAnswers = annotateAnswers;
const llm_1 = require("../llm");
const types_1 = require("../types");
const annotateAnswersCore_1 = require("./annotateAnswersCore");
async function annotateAnswers(session, report) {
    const llm = {
        provider: session.provider,
        model: session.model,
        thinkingEnabled: session.thinkingEnabled,
    };
    if (report.reportKind === "mbti" && report.mbtiReport) {
        return annotateBehavioralMbtiAnswers(session, report);
    }
    const lang = session.language === "zh" ? "中文" : "English";
    const languageRule = annotationLanguageRule(session.language);
    const dimensionSummary = types_1.REPORT_DIMENSIONS.map((dimension) => `${dimension}: ${report.dimensionScores[dimension]}`).join("、");
    const history = session.rounds
        .map((round, index) => `Round ${index + 1}${round.isFollowUp ? " (followup)" : ""}${round.timedOut ? " (timed out)" : ""}
Q: ${round.question}
A: ${round.answer}`)
        .join("\n\n");
    const system = `你是一名面试回答批改专家。请严格以 ${lang} 输出。
${languageRule}

你要对候选人的每轮回答做整体批改，并辅以少量局部标注，帮助用户理解整轮回答的逻辑是否成立、是否真正答到了点上。

标注规则：
- 只输出 JSON，不要输出 markdown
- 先做 roundReviews，再决定 answerAnnotations；整体点评优先，局部标注只是证据，不要本末倒置
- 你批改的重点是：是否真正回应问题、是否围绕个人贡献展开、结构是否清楚、有没有关键支撑和结论
- 尽量从整轮回答的组织与逻辑来评价，不要逐句挑轻微语病、口头词或书面化问题
- quote 必须逐字复制候选人回答中的原文片段，不能改写
- quote 可以是完整句子，也可以是更小的连续片段、短语、关键词组合；只要足够支撑评语即可，不必强行截成整句
- 当某个优点或问题只落在一句话中的局部表达时，优先截取最有代表性的那一小段
- type 只能是 strength、weakness、suggestion、clarity、missing
- dimensions 只能从这 5 个维度中选择：岗位匹配度、回答完整度、逻辑性、专业度、沟通表达
- missing 表示回答缺失但应该补充的信息，可以 quote 为空字符串
- 非 missing 类型必须提供 quote
- 每轮最多 7 条标注，整场最多 40 条
- 标注要少而准，但也要覆盖主要问题，不能只给表扬
- 每轮优先给出 3~6 条有信息量的标注；如果回答问题较多，也可以接近上限
- 局部标注不必只落在“最好的一整句”上，可以分布在多个关键片段上，但不要把一句话切得过碎
- 如果问题主要在整轮逻辑、跑题、没有正面回答、缺少个人贡献或缺少结果，不要拆成很多细碎问题；用 roundReviews 讲清楚，再用少量标注辅助
- 语气要温和、具体、可执行
- 对语音识别产生的轻微错别字、人名/公司名/术语识别偏差要宽松处理，不要因为疑似 ASR 小错误就给 weakness
- 如果一句话核心意思清楚，只是个别字词识别错误，优先不标注，或给 suggestion/clarity，而不是严厉否定
- 只有当错别字或识别错误真正影响理解、逻辑或专业判断时，才允许作为问题指出
- 对口语中的“嗯”“啊”“然后”“就是”“那个”等停顿词、连接词要有容忍度
- 如果一句话只是口语化表达、轻微不够书面、或有轻微语病，但整体不影响理解，就不要标成 weakness
- 面试是口头表达，不是作文批改；不要用书面写作标准去苛责自然口语
- 只有当口语化表达已经明显影响理解、逻辑、专业度或面试观感时，才允许指出
- strength 只能用于真正有说服力的亮点，例如：明确个人贡献、清晰问题拆解、具体解决动作、贴合岗位要求、较完整的结果或反思
- 不要因为“回答比较自然”“态度不错”“基本说清楚了”就轻易给 strength
- 如果一句话只是合格、普通、没有明显亮点，不要标为 strength
- 对于大多数回答，优先识别可以改进的地方；只有在某个片段明显优于平均水平时才给 strength
- 如果一轮回答中同时存在亮点和不足，必须同时标出，不要只标亮点
- 如果一轮回答整体比较一般，允许只有 weakness / suggestion / missing，而没有 strength
- 如果一轮回答的主要问题是“整体结构散、重点不明、没有真正回答问题”，请优先在 overallComment / mainIssue 中指出，而不是集中在个别句子的措辞
- 所有 comment、suggestion、quote 都必须是双引号包裹的合法 JSON 字符串，绝对不要输出未加双引号的中文句子`;
    const userContent = `【公司】${session.company}  【岗位】${session.jobTitle}
【JD 摘要】${session.jd.slice(0, 800)}
【简历摘要】${session.resume.slice(0, 1200)}
【本场考察重点】${session.plan?.focusAreas.join("、") ?? ""}
【五维评分】${dimensionSummary}

【完整面试记录】
${history}

请输出 JSON：
{
  "roundReviews": [
    {
      "roundIndex": 1,
      "overallComment": "${session.language === "en" ? "overall judgement for this round in English: whether it answered the question and whether the logic was clear" : "对这一整轮回答的总体判断，强调是否答到点上、逻辑是否清楚"}",
      "mainStrength": "${session.language === "en" ? "main round-level strength in English; leave empty if there is no clear strength" : "如果这一轮有整体层面的亮点就写；没有可留空"}",
      "mainIssue": "${session.language === "en" ? "core issue in English, prioritizing logic, off-topic answer, missing personal contribution, missing result, or weak role relevance" : "这一轮最核心的问题，优先写整体逻辑、跑题、缺少个人贡献、缺少结果、缺少岗位关联等"}",
      "nextStep": "${session.language === "en" ? "the highest-priority next improvement step in English" : "如果下一次重新回答，这一轮最优先补哪一步"}"
    }
  ],
  "answerAnnotations": [
    {
      "roundIndex": 1,
      "quote": "${session.language === "en" ? "exact text copied from this round's answer; missing type may use an empty string" : "必须逐字出现在该轮 A 中的原文片段；可以是句子，也可以是短语/片段；missing 类型可以为空字符串"}",
      "type": "strength | weakness | suggestion | clarity | missing",
      "dimensions": ["岗位匹配度 | 回答完整度 | 逻辑性 | 专业度 | 沟通表达"],
      "comment": "${session.language === "en" ? "short comment in English" : "对这句话/片段的短评语"}",
      "suggestion": "${session.language === "en" ? "specific improvement suggestion in English; for strength, how to reinforce it" : "具体怎么改；如果是 strength，也可以写如何继续强化"}",
      "severity": "low | medium | high"
    }
  ]
}

额外要求：
- 每一轮都要给出 roundReviews
- 每一轮尽量至少检查这三类内容：亮点、问题、补充建议，但允许“整体没有明显亮点”
- 不要默认每轮都有亮点；如果没有明显亮点，可以不输出 strength
- 如果回答缺少结果、缺少个人贡献、缺少岗位关联、缺少专业细节、缺少复盘，请优先标出这些问题
- 如果回答虽然句子通顺，但整体没有正面回应问题、结构松散、论点和例子对不上，也应明确判为整体问题
- 对于局部标注，优先选择能支撑整体结论的代表性片段；不要求必须是整句
- 如果某轮回答信息量较大，请多标几个关键片段，覆盖亮点、问题和缺失，而不是只标 1~2 处
- 你的批改目标不是鼓励性点评，而是帮助候选人提高下一次面试表现，因此请略微严格一些，但保持公正和具体`;
    const raw = await (0, llm_1.getLLM)(llm).completeJSON({
        system,
        messages: [{ role: "user", content: userContent }],
        thinkingEnabled: llm.thinkingEnabled,
    });
    const answerAnnotations = (0, annotateAnswersCore_1.normalizeAnnotations)(raw.answerAnnotations, session.rounds);
    const roundReviews = (0, annotateAnswersCore_1.normalizeRoundReviews)(raw.roundReviews, session.rounds.length);
    return {
        roundReviews,
        answerAnnotations,
        annotationSummaries: (0, annotateAnswersCore_1.summarizeAnnotations)(answerAnnotations, session.rounds.length),
    };
}
async function annotateBehavioralMbtiAnswers(session, report) {
    const llm = {
        provider: session.provider,
        model: session.model,
        thinkingEnabled: session.thinkingEnabled,
    };
    const lang = session.language === "zh" ? "中文" : "English";
    const languageRule = annotationLanguageRule(session.language);
    const mbti = report.mbtiReport;
    const axisSummary = mbti
        ? Object.values(mbti.axes)
            .map((axis) => `${axis.axis}:${axis.selected}(${axis.tendency}%)`)
            .join("、")
        : "";
    const history = session.rounds
        .map((round, index) => `Round ${index + 1}${round.isFollowUp ? " (followup)" : ""}${round.timedOut ? " (timed out)" : ""}
Q: ${round.question}
A: ${round.answer}`)
        .join("\n\n");
    const system = `你是一名行为面试 MBTI 倾向证据标注专家。请严格以 ${lang} 输出。
${languageRule}

你不是在做传统五维评分，也不是在给修改建议。你的任务是：
- 对每一轮回答做整体点评，说明这一轮主要体现了哪些 MBTI 行为倾向。
- 在候选人的原话中高亮能支撑 E/I/S/N/T/F/J/P 判断的证据片段。
- 高亮标注只用于“判定依据”，不要输出建议型标注。
- 允许指出证据不足，但不要把轻微口语化、停顿词、轻微语病当成问题。
- MBTI 结论只代表本次行为面试语境下的表达倾向，不是真实人格定型。
- quote 必须逐字复制候选人回答中的原文片段，不能改写。
- type 只能使用 mbti_evidence。
- dimensions 固定输出 []。
- mbtiLetters 必须从 E、I、S、N、T、F、J、P 中选择 1~2 个。
- suggestion 字段不要输出。
- 每轮 2~5 条标注，整场最多 32 条。
- 所有字段都必须是合法 JSON 字符串或数组。`;
    const userContent = `【公司】${session.company}  【岗位】${session.jobTitle}
【JD 摘要】${session.jd.slice(0, 800)}
【本场 MBTI 结果】${mbti?.mbtiType ?? ""}
【四维倾向】${axisSummary}

【完整面试记录】
${history}

请输出 JSON：
{
  "roundReviews": [
    {
      "roundIndex": 1,
      "overallComment": "${session.language === "en" ? "English summary of the behavioral tendency shown in this round and whether evidence is sufficient" : "这一轮主要体现了什么行为倾向，以及证据是否充分"}",
      "mainStrength": "${session.language === "en" ? "English strength if this behavioral expression helps job seeking; otherwise leave empty" : "如果这一轮的人格表达对求职有优势，写一句；没有可留空"}",
      "mainIssue": "${session.language === "en" ? "English issue if evidence is insufficient or a tendency risk is clear; otherwise leave empty" : "如果这一轮证据不足或倾向风险明显，写一句；没有可留空"}",
      "nextStep": ""
    }
  ],
  "answerAnnotations": [
    {
      "roundIndex": 1,
      "quote": "${session.language === "en" ? "exact text copied from this round's answer" : "必须逐字出现在该轮 A 中的原文片段"}",
      "type": "mbti_evidence",
      "dimensions": [],
      "mbtiLetters": ["E"],
      "comment": "${session.language === "en" ? "English explanation of why this quote supports the MBTI letter judgement" : "说明这段话为什么能支撑对应 MBTI 字母判断"}",
      "severity": "low | medium | high"
    }
  ]
}`;
    const raw = await (0, llm_1.getLLM)(llm).completeJSON({
        system,
        messages: [{ role: "user", content: userContent }],
        thinkingEnabled: llm.thinkingEnabled,
    });
    const answerAnnotations = (0, annotateAnswersCore_1.normalizeAnnotations)(raw.answerAnnotations, session.rounds);
    const roundReviews = (0, annotateAnswersCore_1.normalizeRoundReviews)(raw.roundReviews, session.rounds.length);
    return {
        roundReviews,
        answerAnnotations,
        annotationSummaries: (0, annotateAnswersCore_1.summarizeAnnotations)(answerAnnotations, session.rounds.length),
    };
}
function annotationLanguageRule(language) {
    if (language === "en") {
        return `Language rule:
- All review text, comments, suggestions, issue descriptions, strengths, and next steps must be English.
- The only field that may preserve non-English text is quote, because quote must exactly copy the candidate's original answer.
- Keep JSON keys, annotation type values, severity values, and internal dimension names exactly as specified.
- Do not output Chinese commentary, Chinese labels, or Chinese fallback phrases in any user-facing review value.`;
    }
    return "语言规则：除 quote 必须复制候选人原文外，所有评语、建议、问题描述、亮点和下一步均使用中文。";
}
