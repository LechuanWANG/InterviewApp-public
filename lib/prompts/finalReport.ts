import { getLLM } from "../llm";
import {
  REPORT_DIMENSIONS,
  REPORT_WEIGHTS,
  type MbtiAxis,
  type MbtiAxisDetail,
  type MbtiLetter,
  type MbtiReport,
  type Report,
  type ReportDimension,
  type ReportDimensionDetail,
  type ReportPenalty,
  type Session,
  type TopicCoverageReport,
} from "../types";
import { findPersona, findDifficulty } from "../personas";

export async function generateReport(session: Session): Promise<Report> {
  const llm = {
    provider: session.provider,
    model: session.model,
    thinkingEnabled: session.thinkingEnabled,
  };
  if (session.interviewType === "behavioral") {
    return generateBehavioralMbtiReport(session);
  }

  const { resume, company, jobTitle, jd, plan, rounds, language, persona, difficulty } =
    session;
  const lang = language === "zh" ? "中文" : "English";
  const languageRule = reportLanguageRule(language);
  const p = findPersona(persona);
  const d = findDifficulty(difficulty);

  const system = `你是一名资深面试评估专家。

本场面试的面试官人格是「${p.label}」（${p.description}），难度档位是「${d.label}」（${d.description}）。评估时请把这个上下文考虑进去：难度越高，对回答完整度、关键能力可信度和业务价值表达的期望也越高；人格不同，考察侧重也不同。

请针对候选人整场面试表现给出结构化、具体、可执行的反馈。严格以 ${lang} 输出。避免空泛表述，务必引用候选人实际回答内容。
${languageRule}

评分体系要求：
- 使用 0-9 的 Band 制评分
- 每个分数只能是 0.5 的倍数
- 只评估 5 个维度：岗位匹配度、回答完整度、逻辑表达清晰度、业务理解与价值表达、关键能力可信度
- 不要输出旧维度：逻辑性、专业度、沟通表达
- 不要输出“数据化表达”维度
- 数据、指标、量化成果只能作为“回答完整度 / 业务理解与价值表达 / 关键能力可信度”的加分证据，不能单独成维度
- AI 智囊团主题、题目意图和预判风险只能作为后台评分依据，不要输出“主题覆盖度”或“主题命中度”维度
- 没有被问到的智囊团主题不能直接作为用户扣分项，只能在建议中说明后续可补测
- dimensionScores、dimensionDetails、weaknesses 中只能批评实际被问到、候选人实际回答过、或候选人主动提到但答得不足的内容
- 对未提问主题，只能在 topicCoverage.nextStep 或 improvementAdvice 中写“后续可补测/可准备”，不能写成候选人已经失败或能力不足
- “关键能力可信度”只能基于实际问答中已经验证到的能力证据和风险信号评分，不得因为某个 high priority 主题未被提问而降分
- 不要输出总分，系统会在后端按固定权重计算综合 Band
- 所有字符串数组中的每一项都必须是双引号包裹的合法 JSON 字符串，绝对不要出现未加双引号的中文句子`;

  const history = rounds
    .map(
      (r, i) =>
        `Round ${i + 1}${r.isFollowUp ? " (followup)" : ""}${r.timedOut ? " (timed out)" : ""}
Q: ${r.question}
A: ${r.answer}`
    )
    .join("\n\n");

  const userContent = `【公司】${company}  【岗位】${jobTitle}
【JD 摘要】${jd.slice(0, 800)}
【简历摘要】${resume.slice(0, 1200)}
【本场考察重点】${plan?.focusAreas.join("、") ?? ""}
【AI 智囊团后台评分上下文】
${formatCouncilScoringContextForReport(session)}

【完整面试记录】
${history}

额外评分边界：
- weaknesses 只能写实际被问到、候选人实际回答过、或候选人主动提到但证据不足的问题。
- dimensionDetails.evidence / dimensionDetails.reason / dimensionDetails.advice 只能围绕本场实际问题和候选人实际回答展开。
- 如果某个 AI 智囊团主题没有被问到，绝对不要把“未展示 / 缺乏 / 没有体现该主题能力”写入 weaknesses 或 dimensionDetails。
- 未被问到的主题只能写入 topicCoverage.nextStep 或 improvementAdvice，并且必须表述为“后续建议补测 / 可准备 / 可进一步验证”，不能表述为候选人已经失败、短板或能力不足。
- 业务理解与价值表达、关键能力可信度可以吸收智囊团主题作为后台判断依据，但只在实际问答已经触达该主题时影响分数。

请输出 JSON：
{
  "dimensionScores": {
    "岗位匹配度": 0-9 且只能是 0.5 的倍数,
    "回答完整度": 0-9 且只能是 0.5 的倍数,
    "逻辑表达清晰度": 0-9 且只能是 0.5 的倍数,
    "业务理解与价值表达": 0-9 且只能是 0.5 的倍数,
    "关键能力可信度": 0-9 且只能是 0.5 的倍数
  },
  "dimensionDetails": {
    "岗位匹配度": {
      "score": 与上面一致,
      "evidence": [${language === "en" ? "\"1-3 evidence points in English; quote the candidate only when necessary\"" : "\"1~3 条证据，引用候选人实际回答或明确指出缺失了什么证据\""}],
      "reason": "${language === "en" ? "one scoring reason in English" : "1 句评分理由"}",
      "advice": "${language === "en" ? "one actionable improvement suggestion in English" : "1 句改进建议"}"
    },
    "回答完整度": { "score": 与上面一致, "evidence": [], "reason": "", "advice": "" },
    "逻辑表达清晰度": { "score": 与上面一致, "evidence": [], "reason": "", "advice": "" },
    "业务理解与价值表达": { "score": 与上面一致, "evidence": [], "reason": "", "advice": "" },
    "关键能力可信度": { "score": 与上面一致, "evidence": [], "reason": "", "advice": "" }
  },
  "strengths": [${language === "en" ? "\"3-5 specific strengths in English\"" : "\"3~5 条具体的亮点，引用候选人实际回答\""}],
  "weaknesses": [${language === "en" ? "\"3-5 specific weaknesses in English\"" : "\"3~5 条具体的短板，指出哪些回答存在的问题\""}],
  "improvementAdvice": [${language === "en" ? "\"3-5 actionable suggestions in English\"" : "\"3~5 条可执行的改进建议\""}],
  "topicCoverage": {
    "summary": "${language === "en" ? "one sentence summarizing which AI-council themes were actually validated by the asked questions; do not blame the candidate for unasked themes" : "一句话总结本场实际问答验证了哪些 AI 智囊团主题；不要把未提问主题归责给候选人"}",
    "coverageRate": 0-100 的整数,
    "topics": [
      {
        "topic": "${language === "en" ? "must match one AI-council priority topic" : "必须对应一个 AI 智囊团优先主题"}",
        "priority": "high | medium | low",
        "status": "covered | partial | uncovered",
        "evidence": "${language === "en" ? "one sentence evidence from the interview record; empty if uncovered" : "一句话说明面试记录中的覆盖证据；未覆盖可为空"}",
        "relatedRounds": [1, 2],
        "nextStep": "${language === "en" ? "one actionable follow-up suggestion for the next interview" : "下一场面试或练习中应该如何补测/强化"}"
      }
    ],
    "schedulingNote": "${language === "en" ? "one sentence explaining whether follow-ups compressed or improved theme coverage" : "一句话解释本场追问/切题调度对主题覆盖的影响"}"
  },
  "betterAnswers": [
    { "question": "${language === "en" ? "original question text for 2-3 weaker answers" : "挑 2~3 个候选人答得不够好的问题原文"}", "suggested": "${language === "en" ? "a stronger sample answer in English, tailored to the resume and JD" : "给出一个更好的回答范例（贴合候选人简历和 JD）"}" }
  ]
}`;

  const raw = await getLLM(llm).completeJSON<Record<string, unknown>>({
    system,
    messages: [{ role: "user", content: userContent }],
    thinkingEnabled: llm.thinkingEnabled,
  });

  return normalizeReport(raw, session);
}

async function generateBehavioralMbtiReport(session: Session): Promise<Report> {
  const llm = {
    provider: session.provider,
    model: session.model,
    thinkingEnabled: session.thinkingEnabled,
  };
  const { resume, company, jobTitle, jd, plan, rounds, language, persona, difficulty } =
    session;
  const lang = language === "zh" ? "中文" : "English";
  const languageRule = reportLanguageRule(language);
  const p = findPersona(persona);
  const d = findDifficulty(difficulty);

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
    .map(
      (round, index) =>
        `Round ${index + 1}${round.isFollowUp ? " (followup)" : ""}${round.timedOut ? " (timed out)" : ""}
Q: ${round.question}
A: ${round.answer}`
    )
    .join("\n\n");

  const userContent = `【公司】${company}  【岗位】${jobTitle}
【JD 摘要】${jd.slice(0, 800)}
【简历摘要】${resume.slice(0, 1200)}
【本场考察重点】${plan?.focusAreas.join("、") ?? ""}
【AI 智囊团优先主题】
${formatCouncilTopicsForReport(session)}

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
  "jobMatches": [${language === "en" ? "\"3-5 English role or team environment suggestions\"" : "\"3~5 条更匹配的岗位 / 团队环境建议\""}],
  "topicCoverage": {
    "summary": "${language === "en" ? "one sentence summarizing AI-council theme coverage" : "一句话总结本场 AI 智囊团主题覆盖情况"}",
    "coverageRate": 0-100 的整数,
    "topics": [
      {
        "topic": "${language === "en" ? "must match one AI-council priority topic" : "必须对应一个 AI 智囊团优先主题"}",
        "priority": "high | medium | low",
        "status": "covered | partial | uncovered",
        "evidence": "${language === "en" ? "one sentence evidence from behavioral answers; empty if uncovered" : "一句话说明行为回答中的覆盖证据；未覆盖可为空"}",
        "relatedRounds": [1, 2],
        "nextStep": "${language === "en" ? "one actionable follow-up suggestion" : "下一场行为面试或练习中应该如何补测/强化"}"
      }
    ],
    "schedulingNote": "${language === "en" ? "one sentence explaining how follow-ups affected theme coverage" : "一句话解释本场追问/切题调度对主题覆盖的影响"}"
  }
}`;

  const raw = await getLLM(llm).completeJSON<Record<string, unknown>>({
    system,
    messages: [{ role: "user", content: userContent }],
    thinkingEnabled: llm.thinkingEnabled,
  });

  const mbtiReport = normalizeMbtiReport(raw, session);
  const emptyScores = Object.fromEntries(
    REPORT_DIMENSIONS.map((dimension) => [dimension, 0])
  ) as Record<ReportDimension, number>;

  return {
    reportKind: "mbti",
    overallBand: 0,
    overallScore: 0,
    rawOverall: 0,
    penalty: 0,
    difficultyAdjustment: 0,
    weights: REPORT_WEIGHTS,
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
    topicCoverage: normalizeTopicCoverage(raw.topicCoverage, session),
  };
}

function normalizeReport(raw: Record<string, unknown>, session: Session): Report {
  const rawDimensionScores = asRecord(raw.dimensionScores);
  const rawCategoryScores = asRecord(raw.categoryScores);
  const rawDimensionDetails = asRecord(raw.dimensionDetails);

  const presentScores = REPORT_DIMENSIONS
    .map((dimension) =>
      resolveDimensionBand(dimension, rawDimensionScores, rawCategoryScores, rawDimensionDetails)
    )
    .filter((value): value is number => value !== null);

  const fallbackScore = presentScores.length
    ? roundToNearestHalf(
        presentScores.reduce((sum, value) => sum + value, 0) / presentScores.length
      )
    : 5;

  const dimensionScores = Object.fromEntries(
    REPORT_DIMENSIONS.map((dimension) => [
      dimension,
      resolveDimensionBand(dimension, rawDimensionScores, rawCategoryScores, rawDimensionDetails) ??
        fallbackScore,
    ])
  ) as Record<ReportDimension, number>;

  const dimensionDetails = Object.fromEntries(
    REPORT_DIMENSIONS.map((dimension) => {
      const source = resolveDimensionDetailSource(dimension, rawDimensionDetails);
      return [
        dimension,
        {
          score: dimensionScores[dimension],
          evidence: asStringArray(source.evidence, 3),
          reason:
            asString(source.reason) ??
            (session.language === "en"
              ? `The current performance on ${dimension} is mixed and still has room to improve.`
              : `该维度表现有一定基础，但仍有明显提升空间。`),
          advice:
            asString(source.advice) ??
            (session.language === "en"
              ? `Use more concrete examples and answer more directly around the interviewer’s question.`
              : `后续回答时要更直接地回应问题，并补充更具体的例子和细节。`),
        } satisfies ReportDimensionDetail,
      ];
    })
  ) as Record<ReportDimension, ReportDimensionDetail>;

  const penalties = computePenalties(session);
  const penalty = roundToQuarter(
    Math.min(
      penalties.reduce((sum, item) => sum + item.points, 0),
      2
    )
  );
  const rawOverall = roundToTwoDecimals(
    REPORT_DIMENSIONS.reduce(
      (sum, dimension) => sum + dimensionScores[dimension] * REPORT_WEIGHTS[dimension],
      0
    )
  );
  const difficultyAdjustment = computeDifficultyAdjustment(session, rawOverall, penalties);
  const overallBand = clampBand(
    roundToNearestHalf(rawOverall - penalty + difficultyAdjustment)
  );

  return {
    overallBand,
    overallScore: overallBand,
    rawOverall,
    penalty,
    difficultyAdjustment,
    weights: REPORT_WEIGHTS,
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
    topicCoverage: normalizeTopicCoverage(raw.topicCoverage, session),
  };
}

function resolveDimensionBand(
  dimension: ReportDimension,
  rawDimensionScores: Record<string, unknown>,
  rawCategoryScores: Record<string, unknown>,
  rawDimensionDetails: Record<string, unknown>
): number | null {
  const direct = coerceBand(
    rawDimensionScores[dimension] ??
      rawCategoryScores[dimension] ??
      asRecord(rawDimensionDetails[dimension]).score
  );
  if (direct !== null) return direct;

  const legacyValues = legacyDimensionAliases(dimension)
    .map((legacyDimension) =>
      coerceBand(
        rawDimensionScores[legacyDimension] ??
          rawCategoryScores[legacyDimension] ??
          asRecord(rawDimensionDetails[legacyDimension]).score
      )
    )
    .filter((value): value is number => value !== null);

  if (!legacyValues.length) return null;
  return roundToNearestHalf(
    legacyValues.reduce((sum, value) => sum + value, 0) / legacyValues.length
  );
}

function resolveDimensionDetailSource(
  dimension: ReportDimension,
  rawDimensionDetails: Record<string, unknown>
): Record<string, unknown> {
  const direct = asRecord(rawDimensionDetails[dimension]);
  if (Object.keys(direct).length > 0) return direct;
  for (const legacyDimension of legacyDimensionAliases(dimension)) {
    const legacy = asRecord(rawDimensionDetails[legacyDimension]);
    if (Object.keys(legacy).length > 0) return legacy;
  }
  return {};
}

function legacyDimensionAliases(dimension: ReportDimension): string[] {
  if (dimension === "岗位匹配度") return ["岗位匹配度"];
  if (dimension === "回答完整度") return ["回答完整度"];
  if (dimension === "逻辑表达清晰度") return ["逻辑性", "沟通表达"];
  if (dimension === "业务理解与价值表达") return ["专业度"];
  if (dimension === "关键能力可信度") return ["岗位匹配度", "专业度"];
  return [];
}

function normalizeMbtiReport(raw: Record<string, unknown>, session: Session): MbtiReport {
  const rawAxes = asRecord(raw.axes);
  const axes = {
    EI: normalizeMbtiAxis("EI", rawAxes.EI, session),
    SN: normalizeMbtiAxis("SN", rawAxes.SN, session),
    TF: normalizeMbtiAxis("TF", rawAxes.TF, session),
    JP: normalizeMbtiAxis("JP", rawAxes.JP, session),
  } satisfies Record<MbtiAxis, MbtiAxisDetail>;

  const inferredType = `${axes.EI.selected}${axes.SN.selected}${axes.TF.selected}${axes.JP.selected}`;
  const mbtiType = normalizeMbtiType(asString(raw.mbtiType), inferredType);

  return {
    mbtiType,
    confidence: clampPercent(toInteger(raw.confidence) ?? 65),
    summary:
      asString(raw.summary) ??
      (session.language === "en"
        ? `The candidate currently shows a behavioral interview style closer to ${mbtiType}.`
        : `候选人在本次行为面试中的表达倾向更接近 ${mbtiType}。`),
    axes,
    strengths: withFallback(
      asStringArray(raw.strengths, 5),
      session.language === "en"
        ? ["The current behavioral style has usable strengths, but more evidence is needed."]
        : ["当前行为风格有可转化为求职优势的部分，但还需要更多回答证据支撑。"]
    ),
    risks: withFallback(
      asStringArray(raw.risks, 5),
      session.language === "en"
        ? ["The current evidence is still limited, so the type judgement should not be over-interpreted."]
        : ["当前证据仍有限，不建议把本次 MBTI 倾向过度绝对化。"]
    ),
    jobMatches: withFallback(
      asStringArray(raw.jobMatches, 5),
      session.language === "en"
        ? ["Choose roles where this communication and decision-making style can be demonstrated with concrete examples."]
        : ["建议选择能用具体经历展示沟通方式、决策方式和协作方式的岗位环境。"]
    ),
  };
}

function normalizeMbtiAxis(
  axis: MbtiAxis,
  value: unknown,
  session: Session
): MbtiAxisDetail {
  const source = asRecord(value);
  const [left, right] = axis.split("") as [MbtiLetter, MbtiLetter];
  const selected = normalizeMbtiLetter(source.selected, left, right);
  return {
    axis,
    left,
    right,
    selected,
    tendency: clampPercent(toInteger(source.tendency) ?? 60),
    evidence: withFallback(
      asStringArray(source.evidence, 2),
      session.language === "en"
        ? ["The current interview evidence is not strong enough, so this is a tentative tendency."]
        : ["当前面试证据还不够充分，因此该维度属于暂定倾向。"]
    ),
    reason:
      asString(source.reason) ??
      (session.language === "en"
        ? `The current answer pattern leans slightly toward ${selected}.`
        : `当前回答表现略微更接近 ${selected} 倾向。`),
  };
}

function normalizeMbtiType(value: string | null, fallback: string): string {
  if (!value) return fallback;
  const compact = value.toUpperCase().replace(/[^EISNTFJP]/g, "");
  if (/^[EI][SN][TF][JP]$/.test(compact)) return compact;
  return fallback;
}

function normalizeMbtiLetter(value: unknown, left: MbtiLetter, right: MbtiLetter): MbtiLetter {
  if (typeof value !== "string") return left;
  const letter = value.trim().toUpperCase();
  return letter === left || letter === right ? (letter as MbtiLetter) : left;
}

function computePenalties(session: Session): ReportPenalty[] {
  const noAnswerTexts = new Set([
    "未作答",
    "未在倒计时内作答",
    "[No answer]",
    "[No answer before timer ended]",
  ]);

  return session.rounds.flatMap((round, index) => {
    const answer = round.answer.trim();
    const compactLength = answer.replace(/\s+/g, "").length;
    const penalties: ReportPenalty[] = [];

    if (noAnswerTexts.has(answer)) {
      penalties.push({
        type: "no_answer",
        points: 0.5,
        roundIndex: index + 1,
        reason:
          session.language === "en"
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
        reason:
          session.language === "en"
            ? `Round ${index + 1} timed out and the answer was too short.`
            : `第 ${index + 1} 轮超时且回答明显过短。`,
      });
    }

    return penalties;
  });
}

function computeDifficultyAdjustment(
  session: Session,
  rawOverall: number,
  penalties: ReportPenalty[]
): number {
  if (session.difficulty !== "hard") return 0;

  const hasPenalty = penalties.length > 0;
  const followupCount = session.rounds.filter((round) => round.isFollowUp).length;
  const hasTimeout = session.rounds.some((round) => round.timedOut);

  if (!hasPenalty && !hasTimeout && followupCount >= 2 && rawOverall >= 7) {
    return 0.5;
  }

  return 0;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asStringArray(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => asString(item))
    .filter((item): item is string => !!item)
    .slice(0, maxItems);
}

function asBetterAnswers(value: unknown): { question: string; suggested: string }[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const obj = asRecord(item);
      const question = asString(obj.question);
      const suggested = asString(obj.suggested);
      if (!question || !suggested) return null;
      return { question, suggested };
    })
    .filter((item): item is { question: string; suggested: string } => !!item)
    .slice(0, 3);
}

function normalizeTopicCoverage(value: unknown, session: Session): TopicCoverageReport | null {
  const councilTopics = getReportPriorityTopics(session);
  if (councilTopics.length === 0) return null;

  const source = asRecord(value);
  const rawTopics = Array.isArray(source.topics) ? source.topics : [];
  const topics = councilTopics.map((topic) => {
    const matched = rawTopics
      .map((item) => asRecord(item))
      .find((item) => normalizeTopicName(asString(item.topic) ?? "") === normalizeTopicName(topic.topic));
    return {
      topic: topic.topic,
      priority: normalizePriority(matched?.priority) ?? topic.priority,
      status: normalizeCoverageStatus(matched?.status),
      evidence: asString(matched?.evidence) ?? "",
      relatedRounds: asRoundNumbers(matched?.relatedRounds, session.rounds.length),
      nextStep:
        asString(matched?.nextStep) ??
        (session.language === "en"
          ? "Use the next practice session to test this theme with a more specific example."
          : "建议在下一场练习中用更具体的问题继续补测该主题。"),
    };
  }).slice(0, 6);

  if (topics.length === 0) return null;
  const computedRate = computeCoverageRate(topics);
  return {
    summary:
      asString(source.summary) ??
      (session.language === "en"
        ? `The interview covered ${topics.filter((item) => item.status === "covered").length} of ${topics.length} AI-council themes fully.`
        : `本场充分覆盖 ${topics.filter((item) => item.status === "covered").length} / ${topics.length} 个 AI 智囊团主题。`),
    coverageRate: clampPercent(toInteger(source.coverageRate) ?? computedRate),
    topics,
    schedulingNote:
      asString(source.schedulingNote) ??
      (session.language === "en"
        ? "The final coverage reflects the tradeoff between follow-up depth and topic breadth."
        : "本场覆盖结果体现了追问深度与主题广度之间的调度取舍。"),
  };
}

function getReportPriorityTopics(session: Session): TopicCoverageReport["topics"] {
  const councilTopics = session.plan?.council?.consensus.priorityTopics ?? [];
  if (councilTopics.length > 0) {
    return councilTopics
      .slice()
      .sort((left, right) => (left.order ?? 999) - (right.order ?? 999))
      .map((item) => ({
        topic: item.topic.trim(),
        priority: item.priority,
        status: "uncovered" as const,
        evidence: "",
        relatedRounds: [],
        nextStep: "",
      }))
      .filter((item) => item.topic)
      .slice(0, 6);
  }
  return (session.plan?.focusAreas ?? [])
    .map((topic, index) => ({
      topic: topic.trim(),
      priority: index < 3 ? "high" as const : "medium" as const,
      status: "uncovered" as const,
      evidence: "",
      relatedRounds: [],
      nextStep: "",
    }))
    .filter((item) => item.topic)
    .slice(0, 6);
}

function formatCouncilTopicsForReport(session: Session): string {
  const topics = getReportPriorityTopics(session);
  if (topics.length === 0) {
    return session.language === "en"
      ? "No AI-council priority topics were recorded. Infer coverage from focusAreas and interview rounds."
      : "未记录 AI 智囊团优先主题，请根据考察重点和面试记录推断覆盖情况。";
  }
  return topics.map((item, index) => `${index + 1}. ${item.topic}（${item.priority}）`).join("\n");
}

function formatCouncilScoringContextForReport(session: Session): string {
  const council = session.plan?.council?.consensus;
  if (!council?.priorityTopics?.length) {
    return session.language === "en"
      ? "No AI-council scoring context was recorded. Use the JD, resume, focusAreas, asked questions, and candidate answers to evaluate the five dimensions. Do not penalize the candidate for unasked topics."
      : "未记录完整 AI 智囊团评分上下文。请根据 JD、简历、本场考察重点、实际问题和候选人回答评价五个维度；不要因为未提问主题而惩罚候选人。";
  }

  const topics = council.priorityTopics
    .slice()
    .sort((left, right) => (left.order ?? 999) - (right.order ?? 999))
    .slice(0, 6)
    .map((topic, index) => {
      const relatedDimensions = inferBusinessDimensionsForCouncilTopic(topic);
      return [
        `${index + 1}. ${topic.topic}（${topic.priority}）`,
        `   来源：${topic.source?.join(" / ") || "unknown"}`,
        `   为什么重要：${topic.reason || ""}`,
        `   主要关联评分维度：${relatedDimensions.join("、")}`,
        `   入口问题：${topic.mainQuestion || ""}`,
        `   追问目标：${(topic.followUpGoals || []).join("；") || ""}`,
        `   退出标准：${(topic.exitCriteria || []).join("；") || ""}`,
        "   评分边界：只有实际问题或回答触达该主题时，才可影响业务维度分；未被提问的主题只能作为后续补测建议，不能直接扣分。",
      ].join("\n");
    })
    .join("\n");

  const risks = (council.predictedRisks || [])
    .slice(0, 4)
    .map(
      (risk, index) =>
        `${index + 1}. ${risk.risk}｜为什么重要：${risk.whyItMatters}｜验证问题：${risk.verificationQuestion}`
    )
    .join("\n");

  const intents = (council.questionIntents || [])
    .slice(0, 8)
    .map(
      (intent, index) =>
        `${index + 1}. Q: ${intent.question}｜意图：${intent.purpose}｜关联主题：${intent.relatedTopics.join("、")}`
    )
    .join("\n");

  return `【主题到评分维度的后台映射】
${topics}

【预判风险】
${risks || "无明确预判风险。"}

【题目意图】
${intents || "未记录题目意图。"}

【重要评分原则】
- 智囊团主题用于理解面试官想验证什么，不是候选人的显性任务。
- 不要输出“主题覆盖度”或“主题命中度”维度。
- 未被问到或未被充分触达的主题，不得直接作为用户扣分项。
- 对实际问答中已经触达的主题，可以根据候选人是否提供了可信证据，影响“业务理解与价值表达”和“关键能力可信度”。
- 未被问到的主题只能进入 topicCoverage.nextStep 或 improvementAdvice，不能进入 dimensionDetails.evidence、dimensionDetails.reason 或 weaknesses。`;
}

function inferBusinessDimensionsForCouncilTopic(
  topic: NonNullable<NonNullable<Session["plan"]>["council"]>["consensus"]["priorityTopics"][number]
): ReportDimension[] {
  const sources = topic.source || [];
  const text = `${topic.topic} ${topic.reason} ${(topic.followUpGoals || []).join(" ")} ${(topic.exitCriteria || []).join(" ")}`;
  const dimensions: ReportDimension[] = [];
  if (sources.includes("jd") || sources.includes("strategy") || /业务|价值|岗位|用户|指标|结果|场景|business|value|impact/i.test(text)) {
    dimensions.push("业务理解与价值表达");
  }
  if (sources.includes("risk") || sources.includes("resume") || /风险|能力|贡献|深度|可信|边界|验证|risk|ownership|depth/i.test(text)) {
    dimensions.push("关键能力可信度");
  }
  return dimensions.length ? dimensions : ["业务理解与价值表达", "关键能力可信度"];
}

function normalizeCoverageStatus(value: unknown): TopicCoverageReport["topics"][number]["status"] {
  return value === "covered" || value === "partial" || value === "uncovered" ? value : "uncovered";
}

function normalizePriority(value: unknown): TopicCoverageReport["topics"][number]["priority"] | null {
  return value === "high" || value === "medium" || value === "low" ? value : null;
}

function asRoundNumbers(value: unknown, maxRound: number): number[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => toInteger(item))
        .filter((item): item is number => !!item && item >= 1 && item <= maxRound)
    )
  ).slice(0, 6);
}

function computeCoverageRate(topics: TopicCoverageReport["topics"]): number {
  if (topics.length === 0) return 0;
  const score = topics.reduce((sum, item) => {
    if (item.status === "covered") return sum + 1;
    if (item.status === "partial") return sum + 0.5;
    return sum;
  }, 0);
  return clampPercent(Math.round((score / topics.length) * 100));
}

function normalizeTopicName(value: string): string {
  return value.toLowerCase().replace(/[“”"'.?？!！,，。；;：:\s]/g, "").trim();
}

function withFallback(items: string[], fallback: string[]): string[] {
  return items.length > 0 ? items : fallback;
}

function reportLanguageRule(language: Session["language"]): string {
  if (language === "en") {
    return `Language rule:
- All user-facing evaluative text must be English, including evidence, reason, advice, strengths, weaknesses, improvementAdvice, betterAnswers.suggested, MBTI summary, axis reasons, risks, and jobMatches.
- Keep JSON keys and the five internal dimension names exactly as specified; do not translate the keys.
- Candidate quotes may preserve the candidate's original wording, but your explanation around the quote must be English.
- Do not output Chinese commentary, Chinese labels, or Chinese fallback phrases in any user-facing value.`;
  }
  return "语言规则：所有面向用户的评语、建议、解释、优势、短板和推荐回答均使用中文。";
}

function toInteger(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(numeric)) return null;
  return Math.round(numeric);
}

function coerceBand(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(numeric)) return null;
  return clampBand(roundToNearestHalf(numeric));
}

function roundToNearestHalf(value: number): number {
  return Math.round(value * 2) / 2;
}

function roundToQuarter(value: number): number {
  return Math.round(value * 4) / 4;
}

function roundToTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}

function clampBand(value: number): number {
  return Math.max(0, Math.min(9, value));
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}
