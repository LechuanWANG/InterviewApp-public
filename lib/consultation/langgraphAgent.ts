import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { getLLM, type LLMOverride } from "../llm";
import type { InterviewHistoryRecord } from "../historyStore";
import type { ConsultGoal, ConsultMessage, ConsultSummary } from "./types";
import {
  consultDialogueIntentInstruction,
  consultDialogueIntentLabel,
  inferConsultDialogueIntent,
  inferConsultTurnIntent,
  type ConsultDialogueIntent,
  type ConsultTurnIntent,
} from "./intent";
import {
  buildConsultSkillPrompt,
  selectConsultSkills,
  selectConsultSkillsWithLLM,
  type ConsultSkillId,
} from "./consultSkills";

export type ConsultAgentTask = "opening" | "reply" | "summary";

type ConsultReply = {
  message?: string;
};

type ConsultSummaryRaw = Partial<ConsultSummary> & {
  closingMessage?: string;
};

export type ConsultAgentInput = {
  task: ConsultAgentTask;
  records: InterviewHistoryRecord[];
  goal: ConsultGoal;
  messages?: ConsultMessage[];
  userMessage?: string;
  memoryDigest?: string;
  conversationCoverageDigest?: string;
  llm?: LLMOverride;
};

export type ConsultAgentOutput =
  | { task: "opening" | "reply"; message: string; selectedSkills: ConsultSkillId[] }
  | {
      task: "summary";
      summary: ConsultSummary;
      closingMessage: string;
      selectedSkills: ConsultSkillId[];
    };

const ConsultGraphState = Annotation.Root({
  task: Annotation<ConsultAgentTask>,
  records: Annotation<InterviewHistoryRecord[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  goal: Annotation<ConsultGoal>,
  messages: Annotation<ConsultMessage[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  userMessage: Annotation<string>({
    reducer: (_left, right) => right,
    default: () => "",
  }),
  memoryDigest: Annotation<string>({
    reducer: (_left, right) => right,
    default: () => "",
  }),
  conversationCoverageDigest: Annotation<string>({
    reducer: (_left, right) => right,
    default: () => "",
  }),
  dialogueIntent: Annotation<ConsultDialogueIntent>({
    reducer: (_left, right) => right,
    default: () => "open_followup",
  }),
  turnIntent: Annotation<ConsultTurnIntent>({
    reducer: (_left, right) => right,
    default: () => "free_question",
  }),
  llm: Annotation<LLMOverride | undefined>({
    reducer: (_left, right) => right,
    default: () => undefined,
  }),
  selectedSkills: Annotation<ConsultSkillId[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  skillPrompt: Annotation<string>({
    reducer: (_left, right) => right,
    default: () => "",
  }),
  message: Annotation<string | undefined>({
    reducer: (_left, right) => right,
    default: () => undefined,
  }),
  summary: Annotation<ConsultSummary | undefined>({
    reducer: (_left, right) => right,
    default: () => undefined,
  }),
  closingMessage: Annotation<string | undefined>({
    reducer: (_left, right) => right,
    default: () => undefined,
  }),
});

type ConsultGraphStateType = typeof ConsultGraphState.State;

const consultGraph = new StateGraph(ConsultGraphState)
  .addNode("select_skills", selectSkillsNode)
  .addNode("generate", generateNode)
  .addEdge(START, "select_skills")
  .addEdge("select_skills", "generate")
  .addEdge("generate", END)
  .compile();

export async function runConsultAgent(input: ConsultAgentInput): Promise<ConsultAgentOutput> {
  const result = await consultGraph.invoke({
    task: input.task,
    records: input.records,
    goal: input.goal,
    messages: input.messages ?? [],
    userMessage: input.userMessage ?? "",
    memoryDigest: input.memoryDigest ?? "",
    conversationCoverageDigest: input.conversationCoverageDigest ?? "",
    dialogueIntent: input.task === "reply" ? inferConsultDialogueIntent(input.userMessage ?? "") : "open_followup",
    turnIntent: input.task === "reply" ? inferConsultTurnIntent(input.userMessage ?? "") : "free_question",
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

async function selectSkillsNode(state: ConsultGraphStateType): Promise<Partial<ConsultGraphStateType>> {
  const selectionInput = {
    records: state.records,
    goal: state.goal,
    inferredIntent: state.turnIntent,
    userMessage: state.userMessage,
    memoryDigest: state.memoryDigest,
    conversationCoverageDigest: state.conversationCoverageDigest,
    llm: state.llm,
  };
  const selectedSkills = state.task === "reply"
    ? await selectConsultSkillsWithLLM(selectionInput)
    : selectConsultSkills(selectionInput);

  return {
    selectedSkills,
    skillPrompt: buildConsultSkillPrompt(selectedSkills),
  };
}

async function generateNode(state: ConsultGraphStateType): Promise<Partial<ConsultGraphStateType>> {
  if (state.task === "summary") {
    const raw = await getLLM(state.llm).completeJSON<ConsultSummaryRaw>({
      system: consultSystemPrompt(state.skillPrompt),
      messages: [{ role: "user", content: buildSummaryPrompt(state) }],
    });
    const summary: ConsultSummary = {
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

  const raw = await getLLM(state.llm).completeJSON<ConsultReply>({
    system: consultSystemPrompt(state.skillPrompt),
    messages: [{ role: "user", content: state.task === "opening" ? buildOpeningPrompt(state) : buildReplyPrompt(state) }],
  });
  return {
    message: raw.message?.trim() || fallbackOpening(state.records),
  };
}

function consultSystemPrompt(skillPrompt: string): string {
  return `你是一位资深的职业战略咨询顾问，和用户一对一聊求职与职业发展，也可以聊与之相关的困惑、选择和心态。

像一个有经验、靠谱、真心想帮人的人那样回应，把话说清楚、说到点上就好——不必端着，也别像在念稿或写报告。
- 先回应用户当下在意的事，再给你的看法和一个具体、能落地的下一步；该直说就直说，但先看到对方做得好的地方，再谈问题。
- 你对用户的了解自然地用就行，不用把"长期记忆/记录显示/根据数据"这类内部说法挂在嘴上，也别重复他刚说过的话。
- 只有当本轮给了你【面试记录】时，才依据其中的真实内容（岗位、分数、短板、原话）做复盘；没有记录就凭经验和你对他的了解来聊，绝不编造或假装看过他的面试。

${skillPrompt}

排版：回复用自然的 Markdown——该分段就分段、要点用列表、关键结论加粗；多场对比、方向取舍这类适合放表格的就用表格。说清楚、有条理即可，不用硬凑格式，也别堆成一大段。
整体输出必须是合法 JSON（不要用代码块包住 JSON 本身），正文写在 message 里。`;
}

function buildOpeningPrompt(state: ConsultGraphStateType): string {
  const memoryBlock = `【长期战略咨询记忆包】
${state.memoryDigest || "暂无历史战略咨询记忆。"}

${recordsDigest(state.records)}`;

  if (state.records.length === 1) {
    return `写一段开场白。用户挑了一场面试想一起看看，请只针对这一场来开场：
先简短点评这一场整体怎么样——大致是什么岗位、有个什么亮点、哪个问题最值得先解决（都依据记录里的真实内容，别空泛、也别牵扯其它场）；再自然地说接下来可以从哪聊起（深入复盘这一场、聊聊方向、或下一步怎么练），把选择交给他。
像个有经验的人在跟他认真聊，不是写报告。约 180 字，用自然的 Markdown。
只输出 JSON：{"message":"..."}。

${memoryBlock}`;
  }

  if (state.records.length > 1) {
    return `写一段开场白。用户挑了下面这几场面试想一起看看，请综合这几场来开场：
先做个综合总结——这几场整体表现怎么样、覆盖了哪些岗位、有什么共同的亮点、哪个问题最反复或最值得先解决（都依据记录里的真实内容，别空泛）；再自然地说接下来可以从哪聊起（重点复盘某一场、归纳共性、聊聊方向），把选择交给他。
像个有经验的人在跟他认真聊，不是写报告。约 200 字，用自然的 Markdown，几场的概览可以放一个小表格。
只输出 JSON：{"message":"..."}。

${memoryBlock}`;
  }

  return `写一段开场白：简短地介绍一下自己（一位资深职业战略顾问），告诉用户可以聊求职方向、岗位、简历、面试复盘，或者就聊聊最近的状态都行；想做有依据的复盘，让你调出他的面试记录就好。最后把话头交给他。
自然、真诚、有判断力，别像模板或报告。约 150 字。
只输出 JSON：{"message":"..."}。

${memoryBlock}`;
}

function buildReplyPrompt(state: ConsultGraphStateType): string {
  const hasRecords = state.records.length > 0;
  const evidenceLine = hasRecords
    ? "本轮调出了他的面试记录，做复盘/判断时用里面的真实内容（岗位、分数、短板、原话）说话。"
    : "本轮没有面试记录，凭经验和你对他的了解来聊，别假装看过他的面试；他若想要有依据的复盘，自然提一句可以帮他调出记录。";
  return `继续和用户聊。先回应他当下在意的事，再把你的看法和一个具体的下一步说清楚。
${evidenceLine}
该追问就问，一次最多一个；说到点上即可，不用面面俱到。结尾顺其自然——有时直接给建议，有时问一句，有时抛个方向，别每轮都用同一套话收尾。
回复用自然的 Markdown（该分点分点、关键处加粗、适合对比的用表格），别堆成一大段。
只输出 JSON：{"message":"..."}。

【用户当前意图】
${consultDialogueIntentLabel(state.dialogueIntent)}

【本轮响应策略】
${consultDialogueIntentInstruction(state.dialogueIntent)}

【本轮业务意图】
${turnIntentLabel(state.turnIntent)}

【长期战略咨询记忆包】
${state.memoryDigest || "暂无历史战略咨询记忆。"}

【当前会话已覆盖内容】
${state.conversationCoverageDigest || "当前会话刚开始。"}

【历史面试记录】
${recordsDigest(state.records)}

【当前对话】
${messagesDigest(state.messages)}

【用户最新回复】
${state.userMessage}`;
}

function buildSummaryPrompt(state: ConsultGraphStateType): string {
  const basis = state.records.length > 0
    ? "请基于历史面试和本次对话生成最终咨询结论。"
    : "请基于本次对话和长期记忆生成最终咨询结论；本次没有面试记录，不要假装看过他的面试数据，相关字段可结合对话与职业经验给出，不要编造面试细节。";
  return `用户已经结束本次战略咨询对话。${basis}只输出 JSON，字段必须为：
{
  "currentJudgement": "当前总体判断",
  "primaryTarget": "建议主攻方向",
  "notRecommended": ["暂不建议方向"],
  "repeatedIssues": ["反复出现的问题"],
  "nextPracticeFocus": ["下一场面试训练重点"],
  "sevenDayPlan": ["未来7天行动计划"],
  "closingMessage": "用资深顾问、像过来人的口吻给用户的一段简短收尾"
}

注意：
- 前面几个字段是结构化要点；closingMessage 是一段真诚、自然的收尾，像一个有经验的人最后跟他说几句，不是生硬的报告结语。约 120-200 字。
- 不要说“综上所述”“建议如下”“本次咨询总结为”这类套话。

【长期战略咨询记忆包】
${state.memoryDigest || "暂无历史战略咨询记忆。"}

【当前会话已覆盖内容】
${state.conversationCoverageDigest || "当前会话刚开始。"}

【历史面试记录】
${recordsDigest(state.records)}

【完整对话】
${messagesDigest(state.messages)}`;
}

function recordsDigest(records: InterviewHistoryRecord[]): string {
  if (!records.length) {
    return "【本轮未调取面试记录】如需有证据的复盘，可在对话中请求调取面试记录；否则凭专业经验与长期记忆作答，不要假装看过其面试数据。";
  }
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
      const formatNote = record.format === "group" ? "\n面试形式：无领导小组讨论（群面）" : "";
      return `【记录${index + 1}】${record.company} · ${record.jobTitle}${formatNote}
综合分数：${record.report.overallBand}/9
五维分数：${scoreText}
优势：${strengths}
短板：${weaknesses}
部分问答：
${sampleRounds}`;
    })
    .join("\n\n");
}

function messagesDigest(messages: ConsultMessage[]): string {
  return messages
    .slice(-10)
    .map((message) => `${message.role === "assistant" ? "AI" : "用户"}：${message.content}`)
    .join("\n\n");
}

function turnIntentLabel(intent: ConsultTurnIntent): string {
  if (intent === "direction_judgement") return "方向判断";
  if (intent === "practice_plan") return "训练计划";
  if (intent === "single_review") return "单场/材料复盘";
  if (intent === "common_issues") return "共性问题诊断";
  if (intent === "evidence_explain") return "解释依据";
  return "开放式问题";
}

function fallbackOpening(records: InterviewHistoryRecord[]): string {
  const first = records[0];
  if (!first) {
    return "你好，我是你的战略咨询顾问。不必先确定目标，也不必先挑选面试场次——求职方向、岗位选择、简历、面试复盘，乃至近期的心态与压力，都可以一起探讨。如果需要有证据的复盘，随时可以让我调取你的面试记录。请说说你目前最想梳理的问题，我会陪你逐步厘清。";
  }
  return `本次你选择的 ${records.length} 场面试，我已掌握其岗位、分数与主要短板。无论是判断方向、复盘某段回答、归纳共性问题，还是制定下一步计划，都可以直接提出，我会逐项为你梳理。`;
}

function fallbackSummary(): ConsultSummary {
  return {
    currentJudgement: "你当前最需要解决的是目标聚焦和回答证据链问题。",
    primaryTarget: "继续围绕当前得分更稳定的岗位方向训练",
    notRecommended: ["短期内不要同时分散准备太多方向"],
    repeatedIssues: ["项目回答缺少难点、行动和结果"],
    nextPracticeFocus: ["优先练项目深挖和岗位动机"],
    sevenDayPlan: ["整理历史面试问题", "重写一个核心项目回答", "再完成一次针对性模拟"],
  };
}

function fallbackClosingMessage(): string {
  return "一个核心判断：方向不宜再分散。你并非没有机会，而是主线还不够清晰。先把一个方向打扎实——把核心项目讲透、把岗位动机说清，会比同时尝试多条路线更稳妥。后续我们可以一步步推进。";
}

function asText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asTextArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const items = value.filter((item): item is string => typeof item === "string" && !!item.trim());
  return items.length ? items.slice(0, 6) : fallback;
}
