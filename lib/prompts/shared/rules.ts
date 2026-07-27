import type { InterviewType, Language } from "@/lib/types";

export function outputLanguageName(language: Language): string {
  return language === "zh" ? "中文" : "English";
}

export function jsonOnlyRule(): string {
  return "严格只输出合法 JSON，不要输出 markdown、解释文字或代码块。";
}

export function languageRule(language: Language): string {
  return language === "zh"
    ? "所有用户可见文本必须使用中文。"
    : "All user-facing text must be English. Do not output Chinese commentary.";
}

export function councilBudgetRule(options: {
  topicTarget: number;
  questionTarget: number;
  maxRounds: number;
}): string {
  return [
    `priorityTopics / focusAreas 必须正好 ${options.topicTarget} 个，超过预算必须合并。`,
    `plannedQuestions 尽量接近 ${options.questionTarget} 个，追问不计入 plannedQuestions。`,
    `所有主题必须能在最多 ${options.maxRounds} 轮内实际覆盖，包含必要追问。`,
    "不得通过增加主题提高满意度；如果新增主题挤压追问空间，budgetFit / executionFeasibility 必须降低。",
  ].join("\n");
}

export function councilSatisfactionRule(threshold: number): string {
  return [
    "满意度不是“主题越多越高”，而是“在当前难度、主题预算、总轮次和追问空间内，主题是否足够关键、精炼、可覆盖”。",
    "请同时考虑 coverageFit、budgetFit、nonRedundancy、executionFeasibility。",
    `达到 ${threshold} 以上且四个分项都不低于 75 时 satisfied 才能为 true。`,
  ].join("\n");
}

export function candidateBriefRule(): string {
  return [
    "candidateBrief 面向候选人，用自然、友好的 C 端表达。",
    "candidateBrief 不得直接复述 openingQuestion、plannedQuestions、mainQuestion 或 verificationQuestion。",
    "candidateBrief 可以适度点明本场关注方向、面试节奏和作答提醒，但不要像评分标准或内部 prompt。",
    "candidateBrief.interviewRhythm 控制在 35-75 个中文字符或 35 个英文单词以内。",
    "candidateBrief.answerAdvice 控制在 35-75 个中文字符或 35 个英文单词以内。",
  ].join("\n");
}

export function councilDecisionPriorityRule(): string {
  return [
    "取舍优先级：",
    "1. 主题预算、轮次上限和可执行性优先。",
    "2. 高优先级主题覆盖优先。",
    "3. 不泄露具体题目优先。",
    "4. 语言自然性优先。",
    "5. 全面性最低，宁可合并，不要罗列。",
  ].join("\n");
}

export function interviewTypeGuardrails(interviewType: InterviewType): string {
  return TYPE_GUARDRAILS[interviewType];
}

export function interviewTypeDescription(interviewType: InterviewType): string {
  return TYPE_DESC[interviewType];
}

export function buildCouncilSharedContext(options: {
  company: string;
  jobTitle: string;
  interviewType: InterviewType;
  personaLabel: string;
  difficultyLabel: string;
  language: Language;
  topicTarget: number;
  questionTarget: number;
  maxRounds: number;
  satisfactionThreshold: number;
  jd: string;
  resume: string;
}): string {
  return `【目标公司】${options.company}
【目标岗位】${options.jobTitle}
【面试类型】${interviewTypeDescription(options.interviewType)}
【面试官人格】${options.personaLabel}
【难度】${options.difficultyLabel}

【执行预算】
${councilBudgetRule({
  topicTarget: options.topicTarget,
  questionTarget: options.questionTarget,
  maxRounds: options.maxRounds,
})}

【JD 摘要】
${textDigest(options.jd, options.language, {
  maxChars: 1800,
  sourceName: options.language === "zh" ? "JD" : "JD",
})}

【候选人简历摘要】
${textDigest(options.resume, options.language, {
  maxChars: 2200,
  sourceName: options.language === "zh" ? "简历" : "resume",
})}

【面试类型边界】
${interviewTypeGuardrails(options.interviewType)}

【满意度定义】
${councilSatisfactionRule(options.satisfactionThreshold)}

${languageRule(options.language)}`;
}

export function compactJson(value: unknown): string {
  return JSON.stringify(value);
}

function textDigest(
  value: string,
  language: Language,
  options: { maxChars: number; sourceName: string }
): string {
  const compact = value
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (compact.length <= options.maxChars) return compact;

  const headLength = Math.round(options.maxChars * 0.72);
  const tailLength = options.maxChars - headLength;
  const head = compact.slice(0, headLength).trim();
  const tail = compact.slice(-tailLength).trim();
  const omitted = compact.length - head.length - tail.length;
  const notice = language === "zh"
    ? `\n\n【${options.sourceName}中段已压缩，省略约 ${omitted} 字；如需判断，以前后片段中的岗位要求、经历证据和风险信号为准。】\n\n`
    : `\n\n[Middle of ${options.sourceName} compressed, about ${omitted} characters omitted. Use the surrounding requirements, evidence, and risk signals for judgment.]\n\n`;
  return `${head}${notice}${tail}`;
}

const TYPE_DESC: Record<InterviewType, string> = {
  hr: "HR/非技术综合面试，侧重软素质、职业动机、稳定性",
  technical: "技术面试，侧重硬技能、项目深度、系统设计",
  behavioral: "行为面试，侧重 STAR 结构、团队协作、冲突处理",
  mixed: "综合面试，混合 HR + 技术 + 行为",
};

const TYPE_GUARDRAILS: Record<InterviewType, string> = {
  hr: "本场是 HR 面。只能围绕职业动机、稳定性、价值观、团队协作、薪资期望、入职意愿、文化匹配等 HR 主题提问。HR 面试官通常不会深入理解算法、系统设计、框架原理、数据库细节等技术内容；如果候选人提到技术项目，只追问业务价值、个人贡献、协作沟通、结果影响和岗位动机，不追问实现细节。",
  technical: "本场是技术面。问题应围绕技术基础、项目技术细节、工程实践、系统设计、问题定位、性能优化等主题，可以适度追问协作，但不要变成纯 HR 面。技术面试官可以使用专业术语并要求候选人解释实现、权衡和边界条件。",
  behavioral: "本场是行为面。问题必须围绕真实经历、团队协作、冲突处理、压力情境、失败复盘、沟通方式、决策偏好等行为事件展开。行为面试官不应深挖技术实现；如果候选人举技术项目，只追问情境、行动、决策、沟通、冲突和结果，不追问代码、模型或架构细节。",
  mixed: "本场是综合面。可以混合 HR、技术、行为问题，但每一轮问题都要贴合简历与 JD，不要无关跳题。综合面可以追问技术项目，但应先让候选人用业务语言解释价值，再按岗位需要适度下钻，避免像纯技术面一样连续深挖底层实现。",
};
