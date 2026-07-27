import type { ConsultGoal } from "./types";
import type { InterviewHistoryRecord } from "../historyStore";
import { inferConsultTurnIntent, type ConsultTurnIntent } from "./intent";
import { getLLM, type LLMOverride } from "../llm";

/**
 * 战略咨询「资深战略咨询顾问」技能体系。
 * - method：纯表达 / 方法论，不需要面试数据，随时可用。
 * - capability：需要面试记录的能力（共性问题、单场复盘、方向取证、进步对比）。
 *   capability 技能只在本轮检索到面试记录（records 非空）时才会被选中，从而实现「按需检索」。
 */
export type ConsultSkillId =
  // method（方法 / 表达）
  | "mentor_voice"
  | "tone_guard"
  | "follow_up_strategy"
  | "peer_experience"
  | "employment_reverse"
  | "median_case"
  | "family_constraint"
  | "choice_over_effort"
  | "social_filter"
  | "irreplacability_test"
  | "city_platform_lens"
  | "ai_era_lens"
  | "health_pace_warning"
  | "role_direction"
  | "practice_plan"
  // capability（需要面试记录）
  | "record_common_issues"
  | "record_single_review"
  | "record_direction_evidence"
  | "record_progress";

type SkillKind = "method" | "capability";

const SKILL_KIND: Record<ConsultSkillId, SkillKind> = {
  mentor_voice: "method",
  tone_guard: "method",
  follow_up_strategy: "method",
  peer_experience: "method",
  employment_reverse: "method",
  median_case: "method",
  family_constraint: "method",
  choice_over_effort: "method",
  social_filter: "method",
  irreplacability_test: "method",
  city_platform_lens: "method",
  ai_era_lens: "method",
  health_pace_warning: "method",
  role_direction: "method",
  practice_plan: "method",
  record_common_issues: "capability",
  record_single_review: "capability",
  record_direction_evidence: "capability",
  record_progress: "capability",
};

export function isCapabilitySkill(id: ConsultSkillId): boolean {
  return SKILL_KIND[id] === "capability";
}

export type SkillSelectionInput = {
  records: InterviewHistoryRecord[];
  goal?: ConsultGoal;
  inferredIntent?: ConsultTurnIntent;
  userMessage?: string;
  memoryDigest?: string;
  selectedMemoryTags?: string[];
  conversationCoverageDigest?: string;
  llm?: LLMOverride;
};

type SkillRouterRaw = Partial<{
  skills: string[];
  reasons: string[];
}>;

const BASE_SKILLS: ConsultSkillId[] = ["mentor_voice", "tone_guard", "follow_up_strategy"];

const ALL_SKILL_IDS = Object.keys(SKILL_KIND) as ConsultSkillId[];

const SKILL_PROMPTS: Record<ConsultSkillId, string> = {
  mentor_voice: `【Skill: 顾问表达风格】
- 你是资深战略咨询顾问：专业、克制、有条理、有温度。
- 结论前置；先回应用户当下的问题或情绪，再给判断，再给一个可执行的下一步。
- 对事不对人，指出问题前先肯定可取之处。
- 书面表达，言简意赅；避免口语化、避免堆砌比喻或举例。不写"综上所述""建议如下"等套话。`,

  tone_guard: `【Skill: 表达基调】
- 正式而温和：保留判断力，去掉尖锐与压迫。
- 给否定结论时，先肯定可取之处，再平和说明，并同步给替代路径；不只制造焦虑，不攻击、不施压。
- 用户受挫时，先承接情绪，再谈问题与改法。`,

  follow_up_strategy: `【Skill: 连续对话】
- 不重复已回答过的问题；用户当前问题优先。
- 仅在缺关键信息时追问，每轮至多 1 个关键问题；信息足够就直接推进建议或判断。`,

  peer_experience: `【Skill: 共情与正常化】
- 适用：用户背景焦虑、起点不高、缺信心或情绪低落时。
- 先承接情绪，基于普遍规律把问题正常化（不夸张、不编造案例、绝不假冒真实人物），再落到一个可执行选择。
- 不灌鸡汤、不泼冷水。`,

  employment_reverse: `【Skill: 就业倒推】
- 从目标岗位的要求、企业筛选标准与可证明的能力证据，倒推当前应准备的重点，而非从兴趣空谈。
- 方向发散时，收敛为主攻 / 备选 / 暂不建议三类。`,

  median_case: `【Skill: 中位数基准】
- 以普通求职者的中位竞争力为基准评估：学历、实习、项目证据、表达稳定性、岗位理解。
- 不以极端样本作判断或安慰；重点关注稳定性与可复制性。`,

  family_constraint: `【Skill: 现实约束】
- 默认试错成本有限：建议需兼顾城市、家庭成本、风险承受与备选路线。
- 信息不足时优先了解上述约束。`,

  choice_over_effort: `【Skill: 方向优先】
- 先确定主攻方向与短期不投入的方向，再安排训练；避免在多个方向平均用力。`,

  social_filter: `【Skill: 筛选标准】
- 候选人按学历、实习、项目、表达、岗位认知等硬性维度被筛选。
- 帮用户明确各环节的通过标准、相对同届的差距，以及可补强的证据项。`,

  irreplacability_test: `【Skill: 不可替代性】
- 把建议落到一个可训练、不易被替代的能力维度：岗位理解、业务拆解、数据意识、跨部门推进、可复盘的项目结果。
- 避免空泛的"提升能力"。`,

  city_platform_lens: `【Skill: 城市与平台】
- 城市、平台与业务线影响机会密度与成长速度。
- 判断顺序：岗位训练价值 → 平台背书 → 生活与试错成本，按需分层建议。`,

  ai_era_lens: `【Skill: AI 影响】
- AI 主要替代低端重复执行，不替代业务理解、复杂判断与跨团队推进。
- 建议善用 AI 提效，同时强化不可替代的判断与业务能力；不渲染焦虑。`,

  health_pace_warning: `【Skill: 节奏管理】
- 用户过度内耗或想同时铺开所有方向时，提示节奏同样是策略。
- 收敛目标、固定训练节奏、定期复盘，避免长期透支。`,

  role_direction: `【Skill: 方向判断】
- 分主攻 / 备选 / 暂不建议三层，依据岗位要求与用户表现，而非一时情绪。
- 评估"是否适合"时，同时给出适合的证据、风险与补救路径。`,

  practice_plan: `【Skill: 训练计划】
- 给 1-3 个可在下一场面试前完成的动作：回答重写、证据补充、追问训练、复盘。
- 优先：岗位动机、核心项目 STAR、个人贡献、结果证据。`,

  record_common_issues: `【Capability: 跨场共性问题】（需面试记录）
- 归纳多场中反复出现的问题，而非逐场罗列。
- 归因维度：岗位认知、项目证据、个人贡献、结果量化、逻辑结构、动机可信度、表达稳定性。
- 引用具体证据（公司/岗位、维度低分、原回答），只取最重要的 1-2 个共性。`,

  record_single_review: `【Capability: 单场复盘】（需面试记录）
- 聚焦指定或最近一场：先评估整场逻辑（是否答到点、是否证明胜任、是否贴合岗位），再到具体措辞。
- 引用该场岗位、分数、维度短板与原回答，给出可执行改法。`,

  record_direction_evidence: `【Capability: 方向取证】（需面试记录）
- 用真实面试表现为方向判断取证：哪个方向得分更稳、证据更足，哪个明显吃力。
- 分主攻 / 备选 / 暂不建议三层，标注每层证据来自哪几场、哪个维度。`,

  record_progress: `【Capability: 进步对比】（需面试记录）
- 对比时间线变化：哪些短板在改善、哪些反复、整体趋势如何。
- 以证据（分数/维度/原回答变化）支撑，并给出下一阶段训练重点。`,
};

const SHORT_SKILL_PROMPTS: Record<ConsultSkillId, string> = {
  mentor_voice: "【顾问风格】资深战略咨询顾问：专业、克制、有条理、有温度；结论前置，书面表达、言简意赅，不口语化、不堆砌比喻。先回应当下问题或情绪，再给判断和一个可执行下一步。",
  tone_guard: "【表达基调】正式而温和：先承接情绪，再给判断与改法；否定时先肯定再说明并给替代路径；不制造无效焦虑，不攻击。",
  follow_up_strategy: "【连续对话】不重复已答问题；每轮至多追问 1 个关键问题，信息足够就直接推进建议或判断。",
  peer_experience: "【共情正常化】先承接情绪，基于普遍规律把问题正常化（不夸张、不编造案例、不假冒真人），再落到一个可执行选择。",
  employment_reverse: "【就业倒推】从岗位要求、筛选标准与可证明证据倒推准备重点；方向发散时收敛主攻/备选/暂不建议。",
  median_case: "【中位数基准】以普通求职者中位竞争力评估（学历、实习、项目证据、表达稳定性、岗位理解），不用极端样本。",
  family_constraint: "【现实约束】默认试错成本有限；建议兼顾城市、家庭成本、风险承受与备选路线。",
  choice_over_effort: "【方向优先】先定主攻与短期不投入的方向，再安排训练；不平均用力。",
  social_filter: "【筛选标准】按学历、实习、项目、表达、岗位认知等硬性维度评估；明确各环节通过标准与可补强证据。",
  irreplacability_test: "【不可替代性】落到一个可训练能力：岗位理解、业务拆解、数据意识、推进能力或项目结果。",
  city_platform_lens: "【城市平台】按岗位训练价值→平台背书→生活与试错成本分层判断，不只看公司名气。",
  ai_era_lens: "【AI 影响】AI 替代低端重复执行；善用 AI 提效，同时强化业务理解与复杂判断；不渲染焦虑。",
  health_pace_warning: "【节奏管理】用户过度内耗时提示节奏也是策略；收敛目标、固定训练、定期复盘。",
  role_direction: "【方向判断】分主攻/备选/暂不建议三层；给出适合证据、风险与补救路径，不只鼓励。",
  practice_plan: "【训练计划】给 1-3 个下一场面试前可完成的动作：回答重写、证据补充、追问训练。",
  record_common_issues: "【共性问题·需记录】归纳多场反复出现的问题（非逐场罗列），引用岗位/维度低分/原回答，取最重要 1-2 个。",
  record_single_review: "【单场复盘·需记录】聚焦一场，先评估整场逻辑再到措辞，引用该场分数/短板/原回答并给改法。",
  record_direction_evidence: "【方向取证·需记录】用真实面试表现为方向判断取证，分主攻/备选/暂不建议并标注证据来源。",
  record_progress: "【进步对比·需记录】对比多场时间线变化（改善/反复/趋势），据此给下一阶段训练重点。",
};

export function selectConsultSkills(input: SkillSelectionInput): ConsultSkillId[] {
  const selected = new Set<ConsultSkillId>(BASE_SKILLS);
  const inferredIntent =
    input.inferredIntent || (input.userMessage ? inferConsultTurnIntent(input.userMessage) : intentFromGoal(input.goal));
  const hasRecords = input.records.length > 0;

  const text = [
    input.goal || "",
    inferredIntent,
    input.userMessage || "",
    input.memoryDigest || "",
    ...(input.selectedMemoryTags || []),
    input.conversationCoverageDigest || "",
    ...input.records.flatMap((record) => [
      record.jobTitle,
      record.company,
      ...(record.report.weaknesses ?? []),
      ...(record.report.improvementAdvice ?? []),
    ]),
  ].join(" ");

  if (inferredIntent === "direction_judgement" || /方向|岗位|适合|主攻|转|投/.test(text)) {
    selected.add("role_direction");
    selected.add("employment_reverse");
    selected.add("median_case");
    selected.add("choice_over_effort");
    if (hasRecords) selected.add("record_direction_evidence");
  }

  if (inferredIntent === "practice_plan" || /练|准备|计划|下一场|提升|怎么改/.test(text)) {
    selected.add("practice_plan");
    selected.add("irreplacability_test");
    if (hasRecords) selected.add("record_progress");
  }

  if (inferredIntent === "common_issues" || input.goal === "common_issues" || input.records.length > 1) {
    selected.add("median_case");
    selected.add("employment_reverse");
    selected.add("social_filter");
    if (hasRecords) selected.add("record_common_issues");
  }

  if (inferredIntent === "single_review" || inferredIntent === "evidence_explain") {
    selected.add("median_case");
    if (hasRecords) selected.add("record_single_review");
  }

  if (/家庭|城市|试错|普通|稳定|保底|风险/.test(text)) {
    selected.add("family_constraint");
  }

  if (/双非|普通本科|背景|学历|起点|没信心|不自信|焦虑|迷茫|纠结|压力|累|崩/.test(text)) {
    selected.add("peer_experience");
    selected.add("social_filter");
  }

  if (/大厂|平台|城市|北京|上海|深圳|广州|杭州|苏州|一线|新一线|小城市/.test(text)) {
    selected.add("city_platform_lens");
  }

  if (/AI|人工智能|大模型|自动化|替代|淘汰|工具/.test(text)) {
    selected.add("ai_era_lens");
    selected.add("irreplacability_test");
  }

  if (/焦虑|熬夜|压力|累|崩|内耗|来不及|全都准备|同时准备/.test(text)) {
    selected.add("health_pace_warning");
    selected.add("choice_over_effort");
  }

  // 没有检索到面试记录时，丢弃所有 capability 技能（它们没有数据可用）。
  return Array.from(selected).filter((id) => hasRecords || !isCapabilitySkill(id));
}

export async function selectConsultSkillsWithLLM(input: SkillSelectionInput): Promise<ConsultSkillId[]> {
  const fallback = selectConsultSkills(input);
  if (!input.userMessage?.trim()) return fallback;

  try {
    const raw = await getLLM(input.llm).completeJSON<SkillRouterRaw>({
      system: "你是求职战略咨询 Agent 的 skill router。只输出合法 JSON，不输出 markdown。",
      messages: [{ role: "user", content: buildSkillRouterPrompt(input, fallback) }],
      thinkingEnabled: false,
    });
    const dynamicSkills = normalizeRoutedSkills(raw.skills || [], input.records.length > 0);
    if (!dynamicSkills.length) return fallback;
    return uniqueSkillIds([...BASE_SKILLS, ...dynamicSkills]);
  } catch (error) {
    console.error("Failed to route consult skills with LLM", error);
    return fallback;
  }
}

export function buildConsultSkillPrompt(skillIds: ConsultSkillId[]): string {
  const lines: string[] = [];
  for (const id of skillIds) {
    const prompt = SHORT_SKILL_PROMPTS[id] || SKILL_PROMPTS[id];
    const next = [...lines, prompt].join("\n\n");
    if (next.length > 900 && lines.length >= 3) break;
    lines.push(prompt);
  }
  return lines.join("\n\n").slice(0, 950);
}

function buildSkillRouterPrompt(input: SkillSelectionInput, fallback: ConsultSkillId[]): string {
  const inferredIntent =
    input.inferredIntent || (input.userMessage ? inferConsultTurnIntent(input.userMessage) : intentFromGoal(input.goal));
  const hasRecords = input.records.length > 0;
  // 没有面试记录时，不把 capability 技能放进候选，避免模型选了却无数据可用。
  const dynamicCandidates = ALL_SKILL_IDS.filter(
    (id) => !BASE_SKILLS.includes(id) && (hasRecords || !isCapabilitySkill(id))
  );
  return `请为本轮开放式战略咨询选择最合适的 dynamic skills。

规则：
- 只从候选 skill id 中选择。
- 最多选择 3 个 dynamic skills，少选比多选好。
- 不要选择 mentor_voice / tone_guard / follow_up_strategy，它们已常驻。
- 用户当前问题优先；长期记忆只作为背景和避重依据。
- peer_experience 只在用户明显背景焦虑、低起点、转行或情绪低落时才选。
- record_* 类技能仅在确实需要分析面试记录时才选（本轮${hasRecords ? "已检索到" : "未检索到"}面试记录）。
- 输出 JSON：{"skills":["skill_id"],"reasons":["简短原因"]}。

【本轮业务意图】
${inferredIntent}

【用户当前问题】
${input.userMessage || "无"}

【候选 skills】
${dynamicCandidates.map((id) => `- ${id}: ${SHORT_SKILL_PROMPTS[id]}`).join("\n")}

【已检索面试摘要】
${recordsForRouting(input.records)}

【长期记忆摘要】
${truncate(input.memoryDigest || "无", 1200)}

【当前会话覆盖】
${truncate(input.conversationCoverageDigest || "无", 500)}

【规则 fallback 结果】
${fallback.join(", ")}`;
}

function normalizeRoutedSkills(values: string[], hasRecords: boolean): ConsultSkillId[] {
  const dynamic = values
    .filter((value): value is ConsultSkillId => isSkillId(value))
    .filter((value) => !BASE_SKILLS.includes(value))
    .filter((value) => hasRecords || !isCapabilitySkill(value));
  return uniqueSkillIds(dynamic).slice(0, 3);
}

function isSkillId(value: string): value is ConsultSkillId {
  return (ALL_SKILL_IDS as string[]).includes(value);
}

function uniqueSkillIds(values: ConsultSkillId[]): ConsultSkillId[] {
  return Array.from(new Set(values));
}

function recordsForRouting(records: InterviewHistoryRecord[]): string {
  if (!records.length) return "无（本轮未检索面试记录，凭专业经验作答）";
  return records
    .slice(0, 4)
    .map((record) => {
      const weaknesses = (record.report.weaknesses || []).slice(0, 3).join("；") || "无";
      const advice = (record.report.improvementAdvice || []).slice(0, 2).join("；") || "无";
      return `- ${record.company} · ${record.jobTitle}｜${record.report.overallBand}/9｜短板：${weaknesses}｜建议：${advice}`;
    })
    .join("\n");
}

function truncate(value: string, maxLength: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text;
}

function intentFromGoal(goal?: ConsultGoal): ConsultTurnIntent {
  if (goal === "direction_judgement") return "direction_judgement";
  if (goal === "practice_plan") return "practice_plan";
  if (goal === "single_review") return "single_review";
  if (goal === "common_issues") return "common_issues";
  return "free_question";
}
