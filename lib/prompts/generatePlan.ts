import { getLLM, type LLMOverride } from "../llm";
import type { InterviewPlan, InterviewPlanCouncil, InterviewType, Language, Persona, Difficulty } from "../types";
import { findPersona, findDifficulty, getMaxInterviewRounds } from "../personas";
import {
  buildCouncilSharedContext,
  candidateBriefRule,
  compactJson,
  councilDecisionPriorityRule,
  interviewTypeDescription,
  interviewTypeGuardrails,
  jsonOnlyRule,
  outputLanguageName,
} from "./shared/rules";

export type InterviewPlanCouncilStreamEvent =
  | { type: "council_started"; message: string }
  | { type: "thinking_status"; role?: string; stage: CouncilThinkingStage; message: string }
  | { type: "meeting_note"; role?: string; stage: CouncilThinkingStage; message: string }
  | { type: "expert_started"; role: string }
  | { type: "expert_completed"; role: string; result: unknown }
  | { type: "expert_skipped"; role: string; result: unknown }
  | { type: "critique_started"; role: string }
  | { type: "critique_completed"; role: string; result: unknown }
  | { type: "revision_started"; role: string }
  | { type: "revision_completed"; role: string; result: unknown }
  | { type: "consensus_started"; role: string }
  | { type: "review_started"; role: string }
  | { type: "review_completed"; role: string; result: unknown }
  | { type: "consensus_completed"; plan: InterviewPlan }
  | { type: "fallback_started"; reason: string }
  | { type: "fallback_completed"; plan: InterviewPlan };

type CouncilEventEmitter = (event: InterviewPlanCouncilStreamEvent) => void | Promise<void>;

type CouncilThinkingStage =
  | "preparing_context"
  | "preparing_expert_input"
  | "reading_jd"
  | "scanning_resume"
  | "planning_route"
  | "awaiting_model_result"
  | "expert_result_ready"
  | "preparing_risk_context"
  | "risk_review"
  | "risk_result_ready"
  | "preparing_consensus_context"
  | "merge_inputs"
  | "draft_ready"
  | "preparing_risk_gate"
  | "risk_gate"
  | "risk_approved"
  | "risk_blocked"
  | "preparing_revision_context"
  | "revision"
  | "revision_ready"
  | "quality_check"
  | "quality_fixed"
  | "creating_session"
  | "fallback";

export async function generateInterviewPlan(params: {
  resume: string;
  company: string;
  jobTitle: string;
  jd: string;
  interviewType: InterviewType;
  language: Language;
  persona: Persona;
  difficulty: Difficulty;
  llm?: LLMOverride;
}): Promise<InterviewPlan> {
  return generateInterviewPlanWithCouncilEvents(params);
}

export async function generateInterviewPlanWithCouncilEvents(params: {
  resume: string;
  company: string;
  jobTitle: string;
  jd: string;
  interviewType: InterviewType;
  language: Language;
  persona: Persona;
  difficulty: Difficulty;
  llm?: LLMOverride;
}, emit?: CouncilEventEmitter): Promise<InterviewPlan> {
  try {
    return await generateInterviewPlanWithCouncil(params, emit);
  } catch (error) {
    console.error("AI council interview plan failed, fallback to single planner:", error);
    await emit?.({
      type: "fallback_started",
      reason: error instanceof Error ? error.message : "AI council failed",
    });
    const fallback = await generateSingleInterviewPlan(params);
    await emit?.({ type: "fallback_completed", plan: fallback });
    return fallback;
  }
}

export async function generateSingleInterviewPlan(params: {
  resume: string;
  company: string;
  jobTitle: string;
  jd: string;
  interviewType: InterviewType;
  language: Language;
  persona: Persona;
  difficulty: Difficulty;
  llm?: LLMOverride;
}): Promise<InterviewPlan> {
  const {
    resume,
    company,
    jobTitle,
    jd,
    interviewType,
    language,
    persona,
    difficulty,
    llm,
  } = params;
  const lang = outputLanguageName(language);
  const p = findPersona(persona);
  const d = findDifficulty(difficulty);
  const maxRounds = getMaxInterviewRounds(difficulty);
  const questionTarget = questionTargetForDifficulty(difficulty, maxRounds);
  const topicTarget = topicTargetForDifficulty(difficulty);

  const system = `${p.styleHint}

${d.hint}

${interviewTypeGuardrails(interviewType)}

请以 ${lang} 输出所有问题与开场白。`;

  const userContent = `请基于以下信息设计一场面试：

【目标公司】${company}
【目标岗位】${jobTitle}
【面试类型】${interviewTypeDescription(interviewType)}
【预计主问题数量】${questionTarget} 个
【JD】
${jd}

【候选人简历】
${resume}

请输出 JSON，字段如下：
{
  "focusAreas": ["本场面试要考察的 ${topicTarget} 个重点维度（结合简历和 JD 的匹配点/差距点）"],
  "plannedQuestions": ["按顺序提问的 ${questionTarget} 个候选问题，贴合简历与 JD，不要扩充问题池"],
  "openingQuestion": "面试开场的第一句话或第一个问题，应符合你的面试官人格风格"
}`;

  const plan = await getLLM(llm).completeJSON<InterviewPlan>({
    system,
    messages: [{ role: "user", content: userContent }],
    thinkingEnabled: llm?.thinkingEnabled,
  });
  return {
    focusAreas: normalizeStringList(plan.focusAreas, topicTarget),
    plannedQuestions: normalizeStringList(plan.plannedQuestions, questionTarget),
    openingQuestion: typeof plan.openingQuestion === "string" && plan.openingQuestion.trim()
      ? plan.openingQuestion.trim()
      : language === "zh"
        ? `欢迎你。我们先从你和 ${jobTitle} 这个岗位的匹配度开始，请你做一个简短自我介绍。`
        : `Welcome. Let's start with your fit for the ${jobTitle} role. Please briefly introduce yourself.`,
  };
}

type CouncilProposal = {
  role: string;
  conclusion: string;
  keyFindings: string[];
  focusAreas: string[];
  satisfaction?: number;
  coverageFit?: number;
  budgetFit?: number;
  nonRedundancy?: number;
  executionFeasibility?: number;
  satisfied?: boolean;
  remainingConcern?: string;
  questionIdeas: {
    question: string;
    purpose: string;
    source: "jd" | "resume" | "risk" | "strategy";
  }[];
  predictedRisks?: {
    risk: string;
    whyItMatters: string;
    verificationQuestion: string;
  }[];
};

type CouncilCritique = {
  role: string;
  conclusion: string;
  keyFindings: string[];
  satisfaction?: number;
  coverageFit?: number;
  budgetFit?: number;
  nonRedundancy?: number;
  executionFeasibility?: number;
  satisfied?: boolean;
  remainingConcern?: string;
  concerns: {
    concern: string;
    targetRole: string;
    resolutionHint: string;
  }[];
  predictedRisks: {
    risk: string;
    whyItMatters: string;
    verificationQuestion: string;
  }[];
};

type CouncilConsensus = InterviewPlan & {
  council: InterviewPlanCouncil;
};

type CouncilReview = {
  role: string;
  conclusion: string;
  satisfaction: number;
  coverageFit?: number;
  budgetFit?: number;
  nonRedundancy?: number;
  executionFeasibility?: number;
  approved: boolean;
  remainingConcern?: string;
};

type CouncilDraftReview = CouncilReview & {
  changeRequest?: string;
  targetSection?: "focusAreas" | "priorityTopics" | "plannedQuestions" | "openingQuestion" | "predictedRisks" | "questionIntents";
};

type LocalQuestionQualityIssue = {
  question: string;
  targetTopic: string;
  issue: string;
  repairInstruction: string;
};

const COUNCIL_SATISFACTION_THRESHOLD = 82;
const MAX_RISK_GATE_ATTEMPTS = 3;

async function generateInterviewPlanWithCouncil(params: {
  resume: string;
  company: string;
  jobTitle: string;
  jd: string;
  interviewType: InterviewType;
  language: Language;
  persona: Persona;
  difficulty: Difficulty;
  llm?: LLMOverride;
}, emit?: CouncilEventEmitter): Promise<InterviewPlan> {
  const {
    resume,
    company,
    jobTitle,
    jd,
    interviewType,
    language,
    persona,
    difficulty,
    llm,
  } = params;
  const lang = outputLanguageName(language);
  const p = findPersona(persona);
  const d = findDifficulty(difficulty);
  const maxRounds = getMaxInterviewRounds(difficulty);
  const questionTarget = questionTargetForDifficulty(difficulty, maxRounds);
  const topicTarget = topicTargetForDifficulty(difficulty);
  const client = getLLM(llm);

  await emit?.({
    type: "council_started",
    message: language === "zh"
      ? "AI 面试智囊团开始审阅简历与 JD。"
      : "The AI interview council has started reviewing the resume and JD.",
  });
  await emit?.({
    type: "thinking_status",
    stage: "preparing_context",
    message: language === "zh"
      ? "正在准备简历、JD 和面试配置上下文。"
      : "Preparing resume, JD, and interview configuration context.",
  });

  const sharedContext = buildCouncilSharedContext({
    company,
    jobTitle,
    interviewType,
    personaLabel: p.label,
    difficultyLabel: d.label,
    language,
    topicTarget,
    questionTarget,
    maxRounds,
    satisfactionThreshold: COUNCIL_SATISFACTION_THRESHOLD,
    jd,
    resume,
  });

  const proposalSystem = `${p.styleHint}

${d.hint}

你是 AI 面试智囊团中的一名专家。你只负责从自己的专业角色提出面试主题建议，不要输出最终完整面试计划。
${jsonOnlyRule()}`;

  const proposalRoles = [
    {
      role: language === "zh" ? "JD 解构官" : "JD Analyst",
      source: "jd" as const,
      task:
        language === "zh"
          ? "拆解 JD 的显性要求、隐性能力模型、业务场景和必须覆盖的考点。"
          : "Break down explicit JD requirements, hidden competency model, business scenarios, and must-cover interview topics.",
    },
    {
      role: language === "zh" ? "简历深挖官" : "Resume Deep-Dive Expert",
      source: "resume" as const,
      task:
        language === "zh"
          ? "从候选人简历中识别最值得深挖的经历、亮点、疑点和个人贡献边界。"
          : "Identify the most valuable resume experiences, strengths, doubts, and boundaries of personal contribution.",
    },
    {
      role: language === "zh" ? "面试策略官" : "Interview Strategy Designer",
      source: "strategy" as const,
      task:
        language === "zh"
          ? "设计面试节奏、问题顺序、压力递进和不同主题之间的衔接。"
          : "Design the interview rhythm, question order, pressure progression, and transitions between topics.",
    },
  ];

  const proposals: CouncilProposal[] = [];
  const satisfactionByRole = new Map<string, number>();

  for (const role of proposalRoles) {
    await emit?.({ type: "expert_started", role: role.role });
    await emit?.({
      type: "thinking_status",
      role: role.role,
      stage: "preparing_expert_input",
      message: expertInputPrepStatus(role.source, proposals.length, language),
    });
    const priorDigest = formatPriorCouncilDigest(proposals, language);
    await emit?.({
      type: "thinking_status",
      role: role.role,
      stage: thinkingStageForSource(role.source),
      message: thinkingStartMessage(role.source, language),
    });
    await emit?.({
      type: "thinking_status",
      role: role.role,
      stage: "awaiting_model_result",
      message: awaitingExpertModelStatus(role.source, language),
    });
    const proposal = await client.completeJSON<CouncilProposal>({
      system: proposalSystem,
      messages: [
        {
          role: "user",
          content: `${sharedContext}

【你的智囊团角色】${role.role}
【你的任务】${role.task}

【前序专家观点摘要】
${priorDigest}

请输出 JSON：
{
  "role": "${role.role}",
  "conclusion": "一句话结论，不超过 35 个中文字符或 25 个英文单词",
  "keyFindings": ["1-2 条关键发现，每条尽量短"],
  "focusAreas": ["1-2 个你认为必须考察的主题"],
  "satisfaction": 0-100,
  "coverageFit": 0-100,
  "budgetFit": 0-100,
  "nonRedundancy": 0-100,
  "executionFeasibility": 0-100,
  "satisfied": false,
  "remainingConcern": "如果满意度未达标，用一句话说明还缺什么；如果已满意可为空",
  "questionIdeas": [
    {
      "question": "一条具体、可直接用于面试的问题",
      "purpose": "这个问题想验证什么",
      "source": "${role.source}"
    }
  ],
  "predictedRisks": [
    {
      "risk": "候选人可能暴露的风险",
      "whyItMatters": "为什么影响岗位匹配",
      "verificationQuestion": "可以用来验证该风险的问题"
    }
  ]
}

要求：
- questionIdeas 控制在 1-2 条。
- predictedRisks 最多 1 条；没有可以输出空数组。
- satisfaction 表示“预算内可执行满意度”，不是完整性堆叠分。
- coverageFit 衡量是否覆盖关键 JD / 简历风险；budgetFit 衡量是否符合 ${topicTarget} 个主题预算；nonRedundancy 衡量是否避免重复细碎主题；executionFeasibility 衡量是否能在 ${maxRounds} 轮内实际覆盖。
- 如果你新增低优先级主题或导致主题超过预算，budgetFit 和 executionFeasibility 必须低于 70。
- 达到 ${COUNCIL_SATISFACTION_THRESHOLD} 以上且四个分项都不低于 75 时 satisfied 才能为 true。
- 问题必须贴合 JD 和简历，避免泛泛而谈。
- 必须参考前序专家观点：可以补充、质疑、合并或排序，但不要重复已经提出的主题和问题。
- 如果你不同意前序专家观点，请在 keyFindings 或 remainingConcern 中简短指出分歧。
- 内容要短，像圆桌会议发言，不要写长篇报告。
- 不要违反面试类型边界。`,
        },
      ],
      thinkingEnabled: llm?.thinkingEnabled,
    });
    proposals.push(proposal);
    satisfactionByRole.set(role.role, normalizeCouncilSatisfaction(proposal));
    await emit?.({
      type: "meeting_note",
      role: role.role,
      stage: "expert_result_ready",
      message: proposalCompletedStatus(proposal, role.source, language),
    });
    await emit?.({ type: "expert_completed", role: role.role, result: proposal });
  }

  const critiqueRole = language === "zh" ? "风险质疑官" : "Risk Challenger";
  let latestCritique: CouncilCritique | null = null;
  await emit?.({ type: "critique_started", role: critiqueRole });
  await emit?.({
    type: "thinking_status",
    role: critiqueRole,
    stage: "preparing_risk_context",
    message: language === "zh"
      ? "正在整理专家提案，准备风险审查上下文。"
      : "Preparing expert proposals for the risk review context.",
  });
  await emit?.({
    type: "thinking_status",
    role: critiqueRole,
    stage: "risk_review",
    message: language === "zh"
      ? `正在审查 ${proposals.length} 位专家提案里的结构风险。`
      : `Reviewing structural risks across ${proposals.length} expert proposals.`,
  });
  await emit?.({
    type: "thinking_status",
    role: critiqueRole,
    stage: "awaiting_model_result",
    message: language === "zh"
      ? "正在等待风险质疑官返回结构化风险意见。"
      : "Waiting for the risk challenger to return structured risk feedback.",
  });
  const critique = await client.completeJSON<CouncilCritique>({
    system: `${p.styleHint}

${d.hint}

你是 AI 面试智囊团中的风险质疑官。你要阅读其他专家提案，指出覆盖漏洞、过于宽泛的问题、缺少压力验证的地方，并提出可验证风险。
${jsonOnlyRule()}`,
    messages: [
      {
        role: "user",
        content: `${sharedContext}

【其他专家提案摘要】
${formatPriorCouncilDigest(proposals, language)}

【其他专家提案原始 JSON（压缩）】
${compactJson(proposals)}

请输出 JSON：
{
  "role": "${critiqueRole}",
  "conclusion": "一句话判断，不超过 35 个中文字符或 25 个英文单词",
  "keyFindings": ["1-2 条关键发现，每条尽量短"],
  "satisfaction": 0-100,
  "coverageFit": 0-100,
  "budgetFit": 0-100,
  "nonRedundancy": 0-100,
  "executionFeasibility": 0-100,
  "satisfied": false,
  "remainingConcern": "如果风险覆盖仍不充分，用一句话说明还缺什么；如果已满意可为空",
  "concerns": [
    {
      "concern": "当前提案中存在的问题或遗漏",
      "targetRole": "被质疑的角色或 all",
      "resolutionHint": "应该如何修正"
    }
  ],
  "predictedRisks": [
    {
      "risk": "候选人可能暴露的风险",
      "whyItMatters": "为什么影响岗位匹配",
      "verificationQuestion": "可以用来验证该风险的问题"
    }
  ]
}

要求：
- 只提真实、重要、可通过面试验证的风险。
- concerns 最多 2 条，predictedRisks 最多 2 条。
- satisfaction 表示当前方案在“风险覆盖 + 主题预算 + 去重 + 可执行性”上的综合满意度。
- 如果其他专家通过增加过多主题来规避风险，而不是合并成 ${topicTarget} 个可执行主题，budgetFit / executionFeasibility 必须降低。
- 达到 ${COUNCIL_SATISFACTION_THRESHOLD} 以上且四个分项都不低于 75 时 satisfied 才能为 true。
- 内容要短，像圆桌会议发言，不要写长篇报告。
- 不要为了质疑而质疑。`,
      },
    ],
    thinkingEnabled: llm?.thinkingEnabled,
  });
  latestCritique = { ...critique, satisfied: false };
  satisfactionByRole.set(critiqueRole, normalizeCouncilSatisfaction(latestCritique));
  await emit?.({
    type: "meeting_note",
    role: critiqueRole,
    stage: "risk_result_ready",
    message: critiqueCompletedStatus(latestCritique, language),
  });
  await emit?.({ type: "critique_completed", role: critiqueRole, result: latestCritique });

  const moderatorRole = language === "zh" ? "主持人" : "Host";
  await emit?.({ type: "consensus_started", role: moderatorRole });
  await emit?.({
    type: "thinking_status",
    role: moderatorRole,
    stage: "preparing_consensus_context",
    message: language === "zh"
      ? "正在压缩专家观点，准备主持人合议上下文。"
      : "Compressing expert inputs for the host consensus context.",
  });
  await emit?.({
    type: "thinking_status",
    role: moderatorRole,
    stage: "merge_inputs",
    message: language === "zh"
      ? `正在合并 ${proposals.length} 位专家观点和风险意见。`
      : `Merging ${proposals.length} expert views and risk feedback.`,
  });
  await emit?.({
    type: "thinking_status",
    role: moderatorRole,
    stage: "awaiting_model_result",
    message: language === "zh"
      ? "正在等待主持人返回结构化面试草案。"
      : "Waiting for the host to return the structured interview draft.",
  });
  let currentDraft = await client.completeJSON<CouncilConsensus>({
    system: `${p.styleHint}

${d.hint}

你是 AI 面试智囊团的主持人。现在综合顺时针讨论观点，形成一版“可被风险把关和定向修改”的面试计划草案。
这不是最终定稿。后续只由风险质疑官做最终风险把关；其他专家意见作为输入，不拥有通过权。
${jsonOnlyRule()}`,
    messages: [
      {
        role: "user",
        content: `${sharedContext}

【专家初稿摘要】
${formatPriorCouncilDigest(proposals, language)}

【专家初稿原始 JSON（压缩）】
${compactJson(proposals)}

【最新风险质疑】
${compactJson(latestCritique)}

【各专家当前状态】
${compactJson(Object.fromEntries(satisfactionByRole.entries()))}

请输出 JSON：
{
  "focusAreas": ["本场面试最终考察的 ${topicTarget} 个重点主题，必须与 priorityTopics 一一对应"],
  "plannedQuestions": ["按顺序排列的 ${questionTarget} 个候选主问题，不包含追问"],
  "openingQuestion": "面试开场第一句话或第一个问题，符合面试官人格",
  "council": {
    "experts": [
      {
        "role": "专家角色名",
        "conclusion": "该专家的核心结论",
        "keyFindings": ["该专家的关键发现"]
      }
    ],
    "consensus": {
      "summary": "智囊团最终合议摘要，说明为什么这样设计本场面试",
      "priorityTopics": [
        {
          "order": 1,
          "topic": "主题名",
          "priority": "high | medium | low",
          "reason": "为什么该主题重要",
          "source": ["jd", "resume", "risk", "strategy"],
          "mainQuestion": "该主题的入口主问题，面试官切到该主题时优先使用",
          "followUpGoals": ["该主题下最值得追问验证的目标，2-3 条"],
          "exitCriteria": ["什么信息足够说明该主题已覆盖，2-3 条"]
        }
      ],
      "predictedRisks": [
        {
          "risk": "面试前预判的候选人风险",
          "whyItMatters": "为什么重要",
          "verificationQuestion": "用于验证该风险的问题"
        }
      ],
      "disagreements": [
        {
          "issue": "专家之间的分歧点；没有明显分歧可输出空数组",
          "positions": ["不同观点"],
          "finalDecision": "最终如何裁决"
        }
      ],
      "candidateBrief": {
        "interviewRhythm": "给候选人看的本场面试节奏说明，不透露 openingQuestion / plannedQuestions / mainQuestion",
        "answerAdvice": "给候选人看的作答建议，不泄露具体题目，不使用负面或审判式措辞"
      },
      "resolutionLog": [
        {
          "expert": "专家角色名",
          "concern": "该专家提出的关键异议；若直接通过则写通过原因",
          "action": "主持人如何采纳、修订、合并或裁决该意见",
          "status": "approved | resolved | adjudicated"
        }
      ],
      "questionIntents": [
        {
          "question": "必须与 openingQuestion 或 plannedQuestions 中某个问题逐字一致",
          "purpose": "这道题的提问意图",
          "raisedBy": "主要来自哪个专家",
          "relatedTopics": ["关联主题"]
        }
      ]
    }
  }
}

硬性要求：
- focusAreas 必须正好 ${topicTarget} 个。
- priorityTopics 必须正好 ${topicTarget} 个；不得多于或少于该数量。
- priorityTopics 必须按面试重要性从高到低排序，order 从 1 开始连续递增。
- 每个 priorityTopic 必须包含 mainQuestion、followUpGoals、exitCriteria；面试阶段会按这个路线图追问或跳转。
- 如果专家意见超过 ${topicTarget} 个主题，必须合并相近主题，而不是简单罗列或新增。
- 主题必须能在最多 ${maxRounds} 轮、且包含必要追问的情况下被实际覆盖；不能为了“全面”牺牲可执行性。
- plannedQuestions 数量必须尽量接近 ${questionTarget} 个；不要为了显得全面而扩充问题池。
- plannedQuestions 应优先等于 priorityTopics.mainQuestion，并按 priorityTopics.order 排序；如有额外主问题，也必须服务于已有主题。
- plannedQuestions 必须贴合 JD 和简历，不能泛泛而谈；每道题都要有追问潜力，能暴露个人贡献、能力边界或岗位风险。
- 每个 high priority topic 至少有 1 个对应主问题或 mainQuestion 能验证。
- openingQuestion 不要重复 plannedQuestions。
- plannedQuestions 不要互相重复。
- ${interviewTypeGuardrails(interviewType)}
- 所有用户可见文本必须使用 ${lang}。
- council.experts 中每个 conclusion 不超过 45 个中文字符或 30 个英文单词。
- council.consensus.summary 不超过 80 个中文字符或 45 个英文单词。
- ${candidateBriefRule().replace(/\n/g, "\n- ")}
- resolutionLog 必须覆盖每个专家角色。JD 解构官、简历深挖官、面试策略官只记录“观点已采纳/已合并”，status 用 resolved，不要用 approved。只有风险质疑官可以使用 approved 或 adjudicated。
- predictedRisks 最多 3 个，disagreements 最多 2 个。
- council.experts 必须包含 JD 解构官、简历深挖官、面试策略官、风险质疑官。

${councilDecisionPriorityRule()}`,
      },
    ],
    thinkingEnabled: llm?.thinkingEnabled,
  });
  let plan = normalizeCouncilPlan(currentDraft, {
    language,
    questionTarget,
    topicTarget,
    fallbackOpening:
      language === "zh"
        ? `欢迎你。我们先从你和 ${jobTitle} 这个岗位的匹配度开始，请你做一个简短自我介绍。`
        : `Welcome. Let's start with your fit for the ${jobTitle} role. Please briefly introduce yourself.`,
  });
  await emit?.({
    type: "meeting_note",
    role: moderatorRole,
    stage: "draft_ready",
    message: planDraftStatus(plan, language),
  });

  await emit?.({
    type: "revision_completed",
    role: moderatorRole,
    result: {
      role: moderatorRole,
      conclusion: language === "zh" ? "已汇总第一版面试计划草案。" : "Initial interview plan draft has been consolidated.",
    },
  });

  let finalRiskGate: CouncilDraftReview | null = null;
  for (let attempt = 1; attempt <= MAX_RISK_GATE_ATTEMPTS; attempt += 1) {
    await emit?.({ type: "critique_started", role: critiqueRole });
    await emit?.({
      type: "thinking_status",
      role: critiqueRole,
      stage: "preparing_risk_gate",
      message: language === "zh"
        ? `正在准备第 ${attempt} 次最终把关材料。`
        : `Preparing materials for final gate review attempt ${attempt}.`,
    });
    await emit?.({
      type: "thinking_status",
      role: critiqueRole,
      stage: "risk_gate",
      message: language === "zh"
        ? `风险质疑官正在进行第 ${attempt} 次最终把关。`
        : `Risk challenger is running final gate review attempt ${attempt}.`,
    });
    await emit?.({
      type: "thinking_status",
      role: critiqueRole,
      stage: "awaiting_model_result",
      message: language === "zh"
        ? "正在等待风险质疑官返回最终把关结论。"
        : "Waiting for the risk challenger to return the final gate decision.",
    });
    const riskGate = await client.completeJSON<CouncilDraftReview>({
      system: `${p.styleHint}

${d.hint}

你是 AI 面试智囊团中的风险质疑官，也是唯一最终把关者。你只判断当前面试计划是否存在结构性风险，不追求主题求全。
如果没有关键风险，必须 approved=true；即使其他专家还想补充主题，也不应阻止进入面试。
${jsonOnlyRule()}`,
      messages: [
        {
          role: "user",
          content: `${sharedContext}

【当前草案】
${compactJson(plan)}

【你的第一轮风险观点】
${compactJson(latestCritique)}

【风险把关轮次】第 ${attempt} 次；最多 ${MAX_RISK_GATE_ATTEMPTS} 次。

请输出 JSON：
{
  "role": "${critiqueRole}",
  "conclusion": "一句话风险判断，不超过 30 个中文字符或 20 个英文单词",
  "satisfaction": 0-100,
  "coverageFit": 0-100,
  "budgetFit": 0-100,
  "nonRedundancy": 0-100,
  "executionFeasibility": 0-100,
  "approved": true,
  "remainingConcern": "如果存在阻断风险，用一句话说明；如果通过可为空",
  "targetSection": "focusAreas | priorityTopics | plannedQuestions | openingQuestion | predictedRisks | questionIntents",
  "changeRequest": "如果不通过，只写一条必须修复的结构性风险；如果通过必须为空"
}

否决范围：
- 面试主题明显偏离 JD 或简历。
- 问题数量、难度或追问空间明显不匹配。
- 面试类型不匹配，例如 HR 面过度技术化。
- 关键风险没有任何问题承接，导致面试无法验证。

不得否决的情况：
- 只是觉得主题“不够全”。
- 只是希望补充低优先级知识点。
- 需要新增主题才能满足你的偏好，但会挤压追问空间。

要求：
- 如果 approved=false，changeRequest 必须能在现有 ${topicTarget} 个主题预算内完成，优先合并、替换、删减、改写，不得新增主题。
- 只有存在上述结构性风险时，approved 才能为 false。
- approved=true 时 satisfaction 至少 ${COUNCIL_SATISFACTION_THRESHOLD}，且 changeRequest 必须为空。
- 不要为了质疑而质疑。`,
        },
      ],
      thinkingEnabled: llm?.thinkingEnabled,
    });

    const normalizedSatisfaction = normalizeCouncilSatisfaction(riskGate);
    const approved = riskGate.approved === true && normalizedSatisfaction >= COUNCIL_SATISFACTION_THRESHOLD && councilSubscoresPass(riskGate);
    finalRiskGate = { ...riskGate, satisfaction: normalizedSatisfaction, approved };
    satisfactionByRole.set(critiqueRole, normalizedSatisfaction);
    await emit?.({
      type: "meeting_note",
      role: critiqueRole,
      stage: approved ? "risk_approved" : "risk_blocked",
      message: riskGateStatus(finalRiskGate, language),
    });
    await emit?.({ type: "critique_completed", role: critiqueRole, result: finalRiskGate });

    if (approved || attempt >= MAX_RISK_GATE_ATTEMPTS) break;

    await emit?.({ type: "revision_started", role: moderatorRole });
    await emit?.({
      type: "thinking_status",
      role: moderatorRole,
      stage: "preparing_revision_context",
      message: language === "zh"
        ? "正在提取风险官阻断意见，准备定向修订上下文。"
        : "Extracting risk gate feedback for a targeted revision context.",
    });
    await emit?.({
      type: "thinking_status",
      role: moderatorRole,
      stage: "revision",
      message: language === "zh"
        ? "主持人正在按风险官意见做定向修订。"
        : "Host is making a targeted revision from the risk feedback.",
    });
    await emit?.({
      type: "thinking_status",
      role: moderatorRole,
      stage: "awaiting_model_result",
      message: language === "zh"
        ? "正在等待主持人返回修订后的结构化方案。"
        : "Waiting for the host to return the revised structured plan.",
    });
    currentDraft = await client.completeJSON<CouncilConsensus>({
      system: `${p.styleHint}

${d.hint}

你是 AI 面试智囊团主持人。风险质疑官发现当前草案存在结构性风险。
你只能围绕风险官指出的问题做定向修订，不要推翻重来，不要增加超过预算的主题。
${jsonOnlyRule()}`,
      messages: [
        {
          role: "user",
          content: `${sharedContext}

【当前草案】
${compactJson(plan)}

【风险官阻断意见】
${compactJson(finalRiskGate)}

请输出修订后的完整 JSON，结构与当前草案一致：
{
  "focusAreas": ["正好 ${topicTarget} 个主题"],
  "plannedQuestions": ["按顺序排列的 ${questionTarget} 个候选主问题，不包含追问"],
  "openingQuestion": "面试开场第一句话或第一个问题",
  "council": {
    "experts": [{ "role": "专家角色名", "conclusion": "核心结论", "keyFindings": ["关键发现"] }],
    "consensus": {
      "summary": "修订后的合议摘要",
      "priorityTopics": [{
        "order": 1,
        "topic": "主题名",
        "priority": "high | medium | low",
        "reason": "原因",
        "source": ["jd", "resume", "risk", "strategy"],
        "mainQuestion": "该主题的入口主问题",
        "followUpGoals": ["该主题下最值得追问验证的目标"],
        "exitCriteria": ["足以判断该主题覆盖完成的标准"]
      }],
      "predictedRisks": [{ "risk": "风险", "whyItMatters": "为什么重要", "verificationQuestion": "验证问题" }],
      "disagreements": [{ "issue": "分歧点", "positions": ["观点"], "finalDecision": "裁决" }],
      "candidateBrief": {
        "interviewRhythm": "给候选人看的本场面试节奏说明，不透露具体题目",
        "answerAdvice": "给候选人看的作答建议，不使用负面或审判式措辞"
      },
      "resolutionLog": [{ "expert": "专家角色名", "concern": "异议或通过原因", "action": "处理方式", "status": "approved | resolved | adjudicated" }],
      "questionIntents": [{ "question": "必须与 openingQuestion 或 plannedQuestions 中某题逐字一致", "purpose": "提问意图", "raisedBy": "专家", "relatedTopics": ["主题"] }]
    }
  }
}

硬性要求：
- focusAreas 和 priorityTopics 必须正好 ${topicTarget} 个。
- 不得新增主题；如需接纳风险点，必须合并、替换或改写已有主题/问题。
- plannedQuestions 必须优先沿用 priorityTopics.mainQuestion，且服务于 priorityTopics。
- plannedQuestions 必须贴合 JD 和简历，不能泛泛而谈；每道题都要有追问潜力，能暴露个人贡献、能力边界或岗位风险。
- 每个 high priority topic 至少有 1 个对应主问题或 mainQuestion 能验证。
- 修订必须直接回应风险官的 changeRequest。
- ${candidateBriefRule().replace(/\n/g, "\n- ")}
- JD 解构官、简历深挖官、面试策略官的意见只能记录为 resolved；只有风险质疑官可 approved 或 adjudicated。
- ${interviewTypeGuardrails(interviewType)}
- 所有用户可见文本必须使用 ${lang}。`,
        },
      ],
      thinkingEnabled: llm?.thinkingEnabled,
    });

    plan = normalizeCouncilPlan(currentDraft, {
      language,
      questionTarget,
      topicTarget,
      fallbackOpening:
        language === "zh"
          ? `欢迎你。我们先从你和 ${jobTitle} 这个岗位的匹配度开始，请你做一个简短自我介绍。`
          : `Welcome. Let's start with your fit for the ${jobTitle} role. Please briefly introduce yourself.`,
    });
    await emit?.({
      type: "meeting_note",
      role: moderatorRole,
      stage: "revision_ready",
      message: planDraftStatus(plan, language),
    });
    await emit?.({
      type: "revision_completed",
      role: moderatorRole,
      result: {
        role: moderatorRole,
        conclusion: language === "zh" ? "已按风险官意见定向修订。" : "Targeted revision completed based on risk gate feedback.",
        keyFindings: [finalRiskGate.changeRequest || finalRiskGate.remainingConcern || ""].filter(Boolean),
      },
    });
  }

  plan = applyCouncilGateResolution(plan, {
    proposalRoles: proposalRoles.map((role) => role.role),
    critiqueRole,
    riskGate: finalRiskGate,
    language,
  });

  const localQuestionIssues = findLocalQuestionQualityIssues(plan, questionTarget);
  if (localQuestionIssues.length > 0) {
    await emit?.({ type: "revision_started", role: moderatorRole });
    await emit?.({
      type: "thinking_status",
      role: moderatorRole,
      stage: "quality_check",
      message: language === "zh"
        ? `本地质量检查发现 ${localQuestionIssues.length} 个问题，正在修复提问结构。`
        : `Local quality check found ${localQuestionIssues.length} issue(s); repairing question structure.`,
    });
    await emit?.({
      type: "thinking_status",
      role: moderatorRole,
      stage: "awaiting_model_result",
      message: language === "zh"
        ? "正在等待主持人返回质检修复后的提问结构。"
        : "Waiting for the host to return the quality-fixed question structure.",
    });
    currentDraft = await client.completeJSON<CouncilConsensus>({
      system: `${p.styleHint}

${d.hint}

你是 AI 面试智囊团主持人。本地质量检查发现 plannedQuestions 存在严重结构问题。
你只能修复 openingQuestion、plannedQuestions、council.consensus.questionIntents 和 council.consensus.candidateBrief；不得修改 focusAreas、priorityTopics 或 predictedRisks。
${jsonOnlyRule()}`,
      messages: [
        {
          role: "user",
          content: `${sharedContext}

【当前方案】
${compactJson(plan)}

【本地质量检查问题】
${compactJson(localQuestionIssues)}

请输出修复后的完整 JSON，结构与当前方案一致。

硬性要求：
- 不得修改 focusAreas。
- 不得修改 council.consensus.priorityTopics。
- 不得修改 council.consensus.predictedRisks，除非只是修正明显措辞错误。
- 只能改 openingQuestion、plannedQuestions、questionIntents、candidateBrief。
- ${candidateBriefRule().replace(/\n/g, "\n- ")}
- plannedQuestions 数量仍然尽量接近 ${questionTarget} 个。
- plannedQuestions 应优先沿用 priorityTopics.mainQuestion，除非该主问题本身质量不达标。
- 每个 high priority topic 至少有 1 个对应问题。
- plannedQuestions 不得为空、不得明显重复、不得短到无法追问。
- 所有用户可见文本必须使用 ${lang}。`,
        },
      ],
      thinkingEnabled: llm?.thinkingEnabled,
    });
    currentDraft.focusAreas = plan.focusAreas;
    if (currentDraft.council?.consensus && plan.council?.consensus) {
      currentDraft.council.consensus.priorityTopics = plan.council.consensus.priorityTopics;
      currentDraft.council.consensus.predictedRisks = plan.council.consensus.predictedRisks;
      currentDraft.council.consensus.candidateBrief =
        currentDraft.council.consensus.candidateBrief ?? plan.council.consensus.candidateBrief;
    }
    plan = normalizeCouncilPlan(currentDraft, {
      language,
      questionTarget,
      topicTarget,
      fallbackOpening:
        language === "zh"
          ? `欢迎你。我们先从你和 ${jobTitle} 这个岗位的匹配度开始，请你做一个简短自我介绍。`
          : `Welcome. Let's start with your fit for the ${jobTitle} role. Please briefly introduce yourself.`,
    });
    await emit?.({
      type: "meeting_note",
      role: moderatorRole,
      stage: "quality_fixed",
      message: planDraftStatus(plan, language),
    });
    await emit?.({
      type: "revision_completed",
      role: moderatorRole,
      result: {
        role: moderatorRole,
        conclusion: language === "zh" ? "已完成本地质量问题修复并裁决定稿。" : "Local quality issues repaired and final decision made.",
        keyFindings: localQuestionIssues.map((item) => item.repairInstruction).filter(Boolean).slice(0, 2),
      },
    });
  }

  plan = applyCouncilGateResolution(plan, {
    proposalRoles: proposalRoles.map((role) => role.role),
    critiqueRole,
    riskGate: finalRiskGate,
    language,
  });

  await emit?.({
    type: "thinking_status",
    role: moderatorRole,
    stage: "creating_session",
    message: language === "zh"
      ? "最终方案已通过，正在创建正式面试会话。"
      : "Final plan approved. Creating the interview session.",
  });
  await emit?.({ type: "consensus_completed", plan });
  return plan;
}

function normalizeCouncilPlan(
  value: CouncilConsensus,
  options: { language: Language; questionTarget: number; topicTarget: number; fallbackOpening: string }
): InterviewPlan {
  const focusAreas = normalizeStringList(value.focusAreas, options.topicTarget);
  const openingQuestion = typeof value.openingQuestion === "string" && value.openingQuestion.trim()
    ? value.openingQuestion.trim()
    : options.fallbackOpening;
  const council = normalizeCouncil(value.council, options.topicTarget);
  const routeQuestions = council?.consensus.priorityTopics
    .map((topic) => topic.mainQuestion || "")
    .filter(Boolean) ?? [];
  const plannedQuestions = normalizeStringList([...routeQuestions, ...normalizeStringList(value.plannedQuestions, options.questionTarget)], options.questionTarget);

  if (focusAreas.length === 0 || plannedQuestions.length === 0 || !council) {
    throw new Error("AI council returned incomplete interview plan");
  }

  return {
    focusAreas,
    plannedQuestions,
    openingQuestion,
    council,
  };
}

function thinkingStartMessage(source: CouncilProposal["questionIdeas"][number]["source"], language: Language): string {
  if (language === "en") {
    if (source === "jd") return "Reading the JD and extracting role-specific capability signals.";
    if (source === "resume") return "Scanning resume evidence against the role requirements.";
    return "Designing the interview route from the current expert inputs.";
  }
  if (source === "jd") return "正在读取 JD，并提取岗位能力信号。";
  if (source === "resume") return "正在对照岗位要求扫描简历证据。";
  return "正在基于已有专家输入设计面试路线。";
}

function awaitingExpertModelStatus(
  source: CouncilProposal["questionIdeas"][number]["source"],
  language: Language
): string {
  if (language === "en") {
    if (source === "jd") return "Waiting for the JD analyst to return structured themes and question ideas.";
    if (source === "resume") return "Waiting for the resume expert to return evidence and follow-up points.";
    return "Waiting for the strategy designer to return the interview route.";
  }
  if (source === "jd") return "正在等待 JD 解构官返回结构化主题和问题建议。";
  if (source === "resume") return "正在等待简历深挖官返回经历证据和追问点。";
  return "正在等待面试策略官返回面试路线。";
}

function expertInputPrepStatus(
  source: CouncilProposal["questionIdeas"][number]["source"],
  priorCount: number,
  language: Language
): string {
  if (language === "en") {
    if (priorCount > 0) return `Preparing this expert's input with ${priorCount} prior council view(s).`;
    if (source === "jd") return "Preparing the JD analyst input scope.";
    if (source === "resume") return "Preparing the resume deep-dive input scope.";
    return "Preparing the interview strategy input scope.";
  }
  if (priorCount > 0) return `正在结合 ${priorCount} 条前序专家观点，准备本轮输入。`;
  if (source === "jd") return "正在准备 JD 解构官的输入范围。";
  if (source === "resume") return "正在准备简历深挖官的输入范围。";
  return "正在准备面试策略官的输入范围。";
}

function thinkingStageForSource(source: CouncilProposal["questionIdeas"][number]["source"]): CouncilThinkingStage {
  if (source === "jd") return "reading_jd";
  if (source === "resume") return "scanning_resume";
  return "planning_route";
}

function proposalCompletedStatus(
  proposal: CouncilProposal,
  source: CouncilProposal["questionIdeas"][number]["source"],
  language: Language
): string {
  const findingCount = proposal.keyFindings?.filter(Boolean).length || 0;
  const topicCount = proposal.focusAreas?.filter(Boolean).length || 0;
  const questionCount = proposal.questionIdeas?.filter((item) => item.question).length || 0;
  const riskCount = proposal.predictedRisks?.filter((item) => item.risk).length || 0;
  if (language === "en") {
    if (source === "jd") return `JD analysis returned ${topicCount} theme(s) and ${questionCount} question idea(s).`;
    if (source === "resume") return `Resume review returned ${findingCount} finding(s) and ${questionCount} probe(s).`;
    return `Strategy review returned ${topicCount} route theme(s) and ${riskCount} risk signal(s).`;
  }
  if (source === "jd") return `JD 解构已返回 ${topicCount} 个主题和 ${questionCount} 个问题建议。`;
  if (source === "resume") return `简历深挖已返回 ${findingCount} 条发现和 ${questionCount} 个追问点。`;
  return `面试策略已返回 ${topicCount} 个路线主题和 ${riskCount} 个风险信号。`;
}

function critiqueCompletedStatus(critique: CouncilCritique, language: Language): string {
  const concernCount = critique.concerns?.filter((item) => item.concern).length || 0;
  const riskCount = critique.predictedRisks?.filter((item) => item.risk).length || 0;
  if (language === "en") {
    return `Risk review returned ${concernCount} concern(s) and ${riskCount} predicted risk(s).`;
  }
  return `风险审查已返回 ${concernCount} 条质疑和 ${riskCount} 个预判风险。`;
}

function riskGateStatus(review: CouncilDraftReview, language: Language): string {
  if (language === "en") {
    return review.approved
      ? `Risk gate approved the plan with satisfaction ${review.satisfaction}.`
      : `Risk gate blocked the draft: ${shortStatusText(review.changeRequest || review.remainingConcern, 72)}`;
  }
  return review.approved
    ? `风险把关已通过，满意度 ${review.satisfaction}。`
    : `风险把关未通过：${shortStatusText(review.changeRequest || review.remainingConcern, 42)}`;
}

function planDraftStatus(plan: InterviewPlan, language: Language): string {
  const topicCount = plan.council?.consensus.priorityTopics.length || plan.focusAreas.length;
  const riskCount = plan.council?.consensus.predictedRisks.length || 0;
  const questionCount = plan.plannedQuestions.length;
  if (language === "en") {
    return `Draft now has ${topicCount} priority topic(s), ${questionCount} main question(s), and ${riskCount} risk focus(es).`;
  }
  return `当前草案已有 ${topicCount} 个优先主题、${questionCount} 个主问题和 ${riskCount} 个风险关注。`;
}

function shortStatusText(value: string | undefined, max: number): string {
  const text = value?.trim() || "";
  if (!text) return "";
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text;
}

function applyCouncilGateResolution(
  plan: InterviewPlan,
  options: {
    proposalRoles: string[];
    critiqueRole: string;
    riskGate: CouncilDraftReview | null;
    language: Language;
  }
): InterviewPlan {
  if (!plan.council) return plan;

  const existingLog = plan.council.consensus.resolutionLog ?? [];
  const riskApproved = options.riskGate?.approved === true;
  const proposalLogs = options.proposalRoles.map((role) =>
    personalizedExpertResolutionLog(plan.council!, existingLog, role, options.language)
  );
  const riskLog = personalizedRiskResolutionLog(plan.council, existingLog, {
    critiqueRole: options.critiqueRole,
    riskGate: options.riskGate,
    riskApproved,
    language: options.language,
  });

  plan.council.consensus.resolutionLog = [...proposalLogs, riskLog];

  return plan;
}

type CouncilResolutionLogItem = NonNullable<InterviewPlanCouncil["consensus"]["resolutionLog"]>[number];
type CouncilPriorityTopic = InterviewPlanCouncil["consensus"]["priorityTopics"][number];

function personalizedExpertResolutionLog(
  council: InterviewPlanCouncil,
  existingLog: CouncilResolutionLogItem[],
  role: string,
  language: Language
): CouncilResolutionLogItem {
  const existing = findCouncilResolution(existingLog, role);
  if (existing && !isGenericResolutionLog(existing)) {
    return { ...existing, status: "resolved" };
  }

  const expert = council.experts.find((item) => sameCouncilRole(item.role, role));
  const source = sourceForCouncilRole(role);
  const topics = topicsForCouncilSource(council.consensus.priorityTopics, source);
  const topicText = formatCouncilTopicList(topics, language);
  const concern = firstSpecificText([
    existing && !isGenericResolutionLog(existing) ? existing.concern : undefined,
    expert?.keyFindings?.[0],
    expert?.conclusion,
    fallbackExpertConcern(source, topicText, language),
  ]);

  return {
    expert: role,
    concern,
    action: expertResolutionAction(source, topicText, language),
    status: "resolved",
  };
}

function personalizedRiskResolutionLog(
  council: InterviewPlanCouncil,
  existingLog: CouncilResolutionLogItem[],
  options: {
    critiqueRole: string;
    riskGate: CouncilDraftReview | null;
    riskApproved: boolean;
    language: Language;
  }
): CouncilResolutionLogItem {
  const existing = findCouncilResolution(existingLog, options.critiqueRole);
  if (existing && !isGenericResolutionLog(existing)) {
    return {
      ...existing,
      status: options.riskApproved ? "approved" : "adjudicated",
    };
  }

  const topRisk = council.consensus.predictedRisks[0]?.risk || "";
  const highTopics = council.consensus.priorityTopics.filter((topic) => topic.priority === "high");
  const topicText = formatCouncilTopicList(highTopics.length ? highTopics : council.consensus.priorityTopics.slice(0, 1), options.language);
  const riskConcern = firstSpecificText([
    existing && !isGenericResolutionLog(existing) ? existing.concern : undefined,
    options.riskGate?.remainingConcern,
    options.riskGate?.changeRequest,
    options.riskGate?.conclusion,
    topRisk,
    options.language === "zh" ? "风险把关完成。" : "Risk gate completed.",
  ]);

  return {
    expert: options.critiqueRole,
    concern: riskConcern,
    action: riskResolutionAction({
      riskApproved: options.riskApproved,
      topRisk,
      topicText,
      riskConcern,
      language: options.language,
    }),
    status: options.riskApproved ? "approved" : "adjudicated",
  };
}

function findCouncilResolution(log: CouncilResolutionLogItem[], role: string): CouncilResolutionLogItem | undefined {
  return log.find((item) => sameCouncilRole(item.expert, role));
}

function sameCouncilRole(left: string, right: string): boolean {
  const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, "");
  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  return normalizedLeft === normalizedRight || normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft);
}

function isGenericResolutionLog(item: CouncilResolutionLogItem): boolean {
  const text = `${item.concern} ${item.action}`;
  if (!item.action.trim()) return true;
  return [
    "该专家观点已作为面试设计输入",
    "主持人已在主题排序、问题设计或追问目标中合并采纳",
    "风险质疑官确认当前方案不存在阻断性结构风险",
    "主持人已在修订上限内处理风险意见",
    "This expert's input has been captured",
    "The host incorporated it into topic ordering",
    "The Risk Challenger confirmed there is no blocking structural risk",
    "The host addressed the risk feedback within the revision limit",
  ].some((fragment) => text.includes(fragment));
}

function sourceForCouncilRole(role: string): "jd" | "resume" | "strategy" | "risk" {
  const normalized = role.toLowerCase().replace(/\s+/g, "");
  if (normalized.includes("jd解构官") || normalized.includes("jdanalyst")) return "jd";
  if (normalized.includes("简历深挖官") || normalized.includes("resume")) return "resume";
  if (normalized.includes("面试策略官") || normalized.includes("strategy")) return "strategy";
  return "risk";
}

function topicsForCouncilSource(
  topics: CouncilPriorityTopic[],
  source: "jd" | "resume" | "strategy" | "risk"
): CouncilPriorityTopic[] {
  const matched = topics.filter((topic) => topic.source.includes(source));
  return (matched.length ? matched : topics).slice(0, 2);
}

function formatCouncilTopicList(topics: CouncilPriorityTopic[], language: Language): string {
  const names = topics.map((topic) => topic.topic).filter(Boolean).slice(0, 2);
  if (!names.length) return language === "zh" ? "核心主题" : "core topics";
  return language === "zh" ? names.join("、") : names.join(" and ");
}

function fallbackExpertConcern(source: "jd" | "resume" | "strategy" | "risk", topicText: string, language: Language): string {
  if (language === "en") {
    if (source === "jd") return `Translate JD requirements into verifiable questions around ${topicText}.`;
    if (source === "resume") return `Use resume evidence to probe ${topicText}.`;
    if (source === "strategy") return `Keep the interview route executable around ${topicText}.`;
    return `Validate risk signals around ${topicText}.`;
  }
  if (source === "jd") return `需要把 JD 要求落到「${topicText}」的可验证问题中。`;
  if (source === "resume") return `需要围绕「${topicText}」深挖简历证据和个人贡献。`;
  if (source === "strategy") return `需要让「${topicText}」的提问顺序和追问空间可执行。`;
  return `需要验证「${topicText}」中的风险信号。`;
}

function expertResolutionAction(source: "jd" | "resume" | "strategy" | "risk", topicText: string, language: Language): string {
  if (language === "en") {
    if (source === "jd") return `Converted into the topic route for ${topicText}, with main questions tied to JD requirements.`;
    if (source === "resume") return `Mapped into follow-up goals for ${topicText}, focusing on evidence and personal contribution.`;
    if (source === "strategy") return `Used to order ${topicText} and reserve space for targeted follow-ups.`;
    return `Kept as risk checks under ${topicText}.`;
  }
  if (source === "jd") return `已转化为「${topicText}」的主题路线，主问题会直接验证 JD 核心要求。`;
  if (source === "resume") return `已落到「${topicText}」的追问目标中，重点验证经历证据和个人贡献。`;
  if (source === "strategy") return `已用于安排「${topicText}」的提问顺序，并预留定向追问空间。`;
  return `已保留为「${topicText}」下的风险验证点。`;
}

function riskResolutionAction(options: {
  riskApproved: boolean;
  topRisk: string;
  topicText: string;
  riskConcern: string;
  language: Language;
}): string {
  if (options.language === "en") {
    if (options.riskApproved) {
      return options.topRisk
        ? `Confirmed that "${options.topRisk}" is covered by questions under ${options.topicText}; the plan can proceed.`
        : `Confirmed that high-priority topics have matching questions and follow-up goals; the plan can proceed.`;
    }
    return `Addressed "${options.riskConcern}" within the topic budget and kept it verifiable under ${options.topicText}.`;
  }
  if (options.riskApproved) {
    return options.topRisk
      ? `已确认「${options.topRisk}」有对应问题承接，并会在「${options.topicText}」中验证。`
      : `已确认高优先级主题均有主问题和追问目标承接，可以进入面试。`;
  }
  return `已按「${options.riskConcern}」在主题预算内定向修订，并保留在「${options.topicText}」中验证。`;
}

function firstSpecificText(candidates: (string | undefined)[]): string {
  return candidates.map((item) => item?.trim()).find((item): item is string => Boolean(item)) || "";
}

function findLocalQuestionQualityIssues(plan: InterviewPlan, questionTarget: number): LocalQuestionQualityIssue[] {
  const issues: LocalQuestionQualityIssue[] = [];
  const questions = plan.plannedQuestions.map((question) => question.trim()).filter(Boolean);
  const topics = plan.council?.consensus.priorityTopics ?? [];

  if (questions.length === 0) {
    issues.push({
      question: "",
      targetTopic: topics[0]?.topic ?? "",
      issue: "plannedQuestions is empty",
      repairInstruction: "Generate executable plannedQuestions from priorityTopics.mainQuestion without changing topics.",
    });
  }

  const normalizedQuestions = questions.map(normalizeQuestionForLocalCheck);
  const duplicate = firstDuplicate(normalizedQuestions);
  if (duplicate) {
    const duplicateQuestion = questions[normalizedQuestions.indexOf(duplicate)] ?? "";
    issues.push({
      question: duplicateQuestion,
      targetTopic: matchingTopicForQuestion(duplicateQuestion, topics),
      issue: "plannedQuestions contains obvious duplicate questions",
      repairInstruction: "Rewrite duplicate questions so each one verifies a distinct priority topic or follow-up route.",
    });
  }

  const tooShort = questions.find((question) => compactLength(question) < 12);
  if (tooShort) {
    issues.push({
      question: tooShort,
      targetTopic: matchingTopicForQuestion(tooShort, topics),
      issue: "plannedQuestion is too short to support a meaningful follow-up",
      repairInstruction: "Rewrite the short question into a concrete interview question tied to JD, resume, or a priority topic.",
    });
  }

  const routeQuestions = topics.map((topic) => topic.mainQuestion?.trim()).filter((question): question is string => Boolean(question));
  if (topics.length > 0 && routeQuestions.length === 0) {
    issues.push({
      question: "",
      targetTopic: topics[0]?.topic ?? "",
      issue: "priorityTopics are missing mainQuestion",
      repairInstruction: "Fill every priorityTopics.mainQuestion and align plannedQuestions to those route questions.",
    });
  }

  const highPriorityWithoutQuestion = topics.find((topic) =>
    topic.priority === "high" &&
    !questions.some((question) => questionMatchesTopic(question, topic.topic, topic.mainQuestion))
  );
  if (highPriorityWithoutQuestion) {
    issues.push({
      question: "",
      targetTopic: highPriorityWithoutQuestion.topic,
      issue: "high priority topic has no obvious plannedQuestion",
      repairInstruction: "Add or rewrite one plannedQuestion so it clearly verifies this high priority topic.",
    });
  }

  if (questions.length < Math.max(2, Math.min(questionTarget, 3))) {
    issues.push({
      question: "",
      targetTopic: topics[0]?.topic ?? "",
      issue: "plannedQuestions count is too low for the configured interview",
      repairInstruction: "Increase plannedQuestions to cover the highest-priority route questions while staying within the target count.",
    });
  }

  return issues.slice(0, 4);
}

function normalizeQuestionForLocalCheck(question: string): string {
  return question
    .toLowerCase()
    .replace(/[？?。.,，、\s"'“”‘’：:；;！!]/g, "")
    .trim();
}

function firstDuplicate(values: string[]): string | null {
  const seen = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    if (seen.has(value)) return value;
    seen.add(value);
  }
  return null;
}

function compactLength(value: string): number {
  return value.replace(/\s/g, "").length;
}

function matchingTopicForQuestion(
  question: string,
  topics: NonNullable<InterviewPlan["council"]>["consensus"]["priorityTopics"]
): string {
  return topics.find((topic) => questionMatchesTopic(question, topic.topic, topic.mainQuestion))?.topic ?? "";
}

function questionMatchesTopic(question: string, topic: string, mainQuestion?: string): boolean {
  const normalizedQuestion = normalizeQuestionForLocalCheck(question);
  const normalizedTopic = normalizeQuestionForLocalCheck(topic);
  const normalizedMainQuestion = normalizeQuestionForLocalCheck(mainQuestion ?? "");
  return Boolean(
    normalizedTopic && normalizedQuestion.includes(normalizedTopic) ||
    normalizedMainQuestion && (normalizedQuestion.includes(normalizedMainQuestion) || normalizedMainQuestion.includes(normalizedQuestion))
  );
}

function formatPriorCouncilDigest(proposals: CouncilProposal[], language: Language): string {
  if (proposals.length === 0) {
    return language === "zh"
      ? "暂无前序发言，你是第一位发言专家。"
      : "No prior comments yet. You are the first expert to speak.";
  }

  return proposals
    .map((proposal, index) => {
      const findings = proposal.keyFindings?.slice(0, 2).join("；") || "";
      const focusAreas = proposal.focusAreas?.slice(0, 2).join("；") || "";
      const questionIdeas = proposal.questionIdeas?.slice(0, 1).map((item) => item.question).join("；") || "";
      const lines = [
        `${index + 1}. ${proposal.role}: ${proposal.conclusion}`,
        findings ? `   ${language === "zh" ? "发现" : "Findings"}：${findings}` : "",
        focusAreas ? `   ${language === "zh" ? "主题" : "Themes"}：${focusAreas}` : "",
        questionIdeas ? `   ${language === "zh" ? "问题" : "Question"}：${questionIdeas}` : "",
      ];
      return lines.filter(Boolean).join("\n");
    })
    .join("\n");
}

function normalizeCouncil(value: unknown, topicTarget = 5): InterviewPlanCouncil | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<InterviewPlanCouncil>;
  const consensus = raw.consensus;
  if (!consensus || typeof consensus !== "object") return null;

  const experts = Array.isArray(raw.experts)
    ? raw.experts
        .map((item) => ({
          role: asString(item?.role),
          conclusion: asString(item?.conclusion),
          keyFindings: normalizeStringList(item?.keyFindings, 5),
        }))
        .filter((item) => item.role && item.conclusion)
        .slice(0, 5)
    : [];

  const priorityTopics = Array.isArray(consensus.priorityTopics)
    ? consensus.priorityTopics
        .map((item, index) => ({
          order: numericOrder(item?.order, index + 1),
          topic: asString(item?.topic),
          priority: toPriority(item?.priority),
          reason: asString(item?.reason),
          source: normalizeSources(item?.source),
          mainQuestion: asString(item?.mainQuestion),
          followUpGoals: normalizeStringList(item?.followUpGoals, 3),
          exitCriteria: normalizeStringList(item?.exitCriteria, 3),
        }))
        .filter((item) => item.topic && item.reason)
        .sort((left, right) => left.order - right.order || priorityRank(left.priority) - priorityRank(right.priority))
        .slice(0, topicTarget)
    : [];

  const predictedRisks = Array.isArray(consensus.predictedRisks)
    ? consensus.predictedRisks
        .map((item) => ({
          risk: asString(item?.risk),
          whyItMatters: asString(item?.whyItMatters),
          verificationQuestion: asString(item?.verificationQuestion),
        }))
        .filter((item) => item.risk && item.whyItMatters)
        .slice(0, 5)
    : [];

  const disagreements = Array.isArray(consensus.disagreements)
    ? consensus.disagreements
        .map((item) => ({
          issue: asString(item?.issue),
          positions: normalizeStringList(item?.positions, 4),
          finalDecision: asString(item?.finalDecision),
        }))
        .filter((item) => item.issue && item.finalDecision)
        .slice(0, 3)
    : [];

  const resolutionLog = Array.isArray(consensus.resolutionLog)
    ? consensus.resolutionLog
        .map((item) => ({
          expert: asString(item?.expert),
          concern: asString(item?.concern),
          action: asString(item?.action),
          status: toResolutionStatus(item?.status),
        }))
        .filter((item) => item.expert && item.action)
        .slice(0, 6)
    : [];

  const questionIntents = Array.isArray(consensus.questionIntents)
    ? consensus.questionIntents
        .map((item) => ({
          question: asString(item?.question),
          purpose: asString(item?.purpose),
          raisedBy: asString(item?.raisedBy),
          relatedTopics: normalizeStringList(item?.relatedTopics, 4),
        }))
        .filter((item) => item.question && item.purpose)
        .slice(0, 12)
    : [];

  const candidateBrief = normalizeCandidateBrief(consensus.candidateBrief);

  return {
    experts,
    consensus: {
      summary: asString(consensus.summary),
      priorityTopics,
      predictedRisks,
      disagreements,
      candidateBrief,
      resolutionLog,
      questionIntents,
    },
  };
}

function normalizeCandidateBrief(value: unknown): InterviewPlanCouncil["consensus"]["candidateBrief"] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as { interviewRhythm?: unknown; answerAdvice?: unknown };
  const interviewRhythm = sanitizeCandidateBriefText(asString(raw.interviewRhythm), 120);
  const answerAdvice = sanitizeCandidateBriefText(asString(raw.answerAdvice), 120);
  if (!interviewRhythm && !answerAdvice) return undefined;
  return { interviewRhythm, answerAdvice };
}

function sanitizeCandidateBriefText(value: string, max: number): string {
  const blocked = [
    "openingQuestion",
    "plannedQuestions",
    "mainQuestion",
    "verificationQuestion",
  ];
  const hasBlocked = blocked.some((item) => value.includes(item));
  if (hasBlocked) return "";
  return trimByLength(value, max);
}

function trimByLength(value: string, max: number): string {
  if (!value) return "";
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function normalizeStringList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    )
  ).slice(0, max);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

type CouncilSatisfactionLike = {
  satisfaction?: unknown;
  coverageFit?: unknown;
  budgetFit?: unknown;
  nonRedundancy?: unknown;
  executionFeasibility?: unknown;
  satisfied?: unknown;
};

function normalizeCouncilSatisfaction(value: CouncilSatisfactionLike): number {
  const explicit = normalizeSatisfaction(value.satisfaction, value.satisfied === true);
  const subscores = [
    numericScore(value.coverageFit),
    numericScore(value.budgetFit),
    numericScore(value.nonRedundancy),
    numericScore(value.executionFeasibility),
  ];
  const validSubscores = subscores.filter((item): item is number => item !== null);
  if (validSubscores.length === 4) {
    const weighted = Math.round(
      validSubscores[0] * 0.35 +
      validSubscores[1] * 0.25 +
      validSubscores[2] * 0.2 +
      validSubscores[3] * 0.2
    );
    return Math.min(explicit || weighted, weighted);
  }
  return explicit;
}

function councilSubscoresPass(value: CouncilSatisfactionLike): boolean {
  const subscores = [
    numericScore(value.coverageFit),
    numericScore(value.budgetFit),
    numericScore(value.nonRedundancy),
    numericScore(value.executionFeasibility),
  ];
  const validSubscores = subscores.filter((item): item is number => item !== null);
  if (validSubscores.length === 0) return value.satisfied === true;
  return validSubscores.length === 4 && validSubscores.every((item) => item >= 75);
}

function numericScore(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeSatisfaction(value: unknown, satisfied?: boolean): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(100, Math.round(value)));
  }
  return satisfied ? COUNCIL_SATISFACTION_THRESHOLD : 0;
}

function toPriority(value: unknown): "high" | "medium" | "low" {
  return value === "high" || value === "medium" || value === "low" ? value : "medium";
}

function numericOrder(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : fallback;
}

function priorityRank(value: "high" | "medium" | "low"): number {
  if (value === "high") return 0;
  if (value === "medium") return 1;
  return 2;
}

function toResolutionStatus(value: unknown): "approved" | "resolved" | "adjudicated" {
  if (value === "approved" || value === "resolved" || value === "adjudicated") return value;
  return "resolved";
}

function normalizeSources(value: unknown): ("jd" | "resume" | "risk" | "strategy")[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set(["jd", "resume", "risk", "strategy"]);
  return Array.from(new Set(value.filter((item): item is "jd" | "resume" | "risk" | "strategy" =>
    typeof item === "string" && allowed.has(item)
  )));
}

function questionTargetForDifficulty(difficulty: Difficulty, maxRounds: number): number {
  if (difficulty === "easy") return Math.min(maxRounds, 5);
  if (difficulty === "medium") return Math.min(maxRounds, 5);
  if (difficulty === "hard") return Math.min(maxRounds, 4);
  if (difficulty === "realistic") return Math.min(maxRounds, 5);
  return Math.min(maxRounds, 5);
}

function topicTargetForDifficulty(difficulty: Difficulty): number {
  if (difficulty === "easy") return 3;
  if (difficulty === "medium") return 4;
  return 4;
}
