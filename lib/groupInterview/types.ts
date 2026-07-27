import type { Language, Difficulty, ReportDimensionDetail } from "@/lib/types";
import type { VoiceSettings } from "@/lib/voice/types";

// ============================================================
// 智能群面（AI 无领导小组讨论）核心类型
// 见 docs/plan/ai-group-interview-plan.md
// ============================================================

export type Gender = "male" | "female";

// ---------- 讨论人格 ----------
export type GroupPersonaId =
  | "leader" // 领跑者
  | "synthesizer" // 总结者
  | "analyst" // 数据派
  | "challenger" // 激进派
  | "supporter" // 稳健派
  | "quiet"; // 边缘者

// ---------- 角色 ----------
export type GroupMemberKind = "user" | "student" | "host" | "leader";

export type GroupMember = {
  id: string; // "user" | "student_1" ...
  kind: GroupMemberKind;
  name: string;
  gender: Gender;
  avatarKey: string; // public/avatars/group-interview/ 下的文件名(不含扩展名)，user/host 为状态图
  voice: string; // 豆包音色 id
  persona?: GroupPersonaId; // 学生人格
  background?: string; // 背景画像一句话
};

// ---------- 题目 ----------
export type GroupTopicType =
  | "open_strategy" // 开放策略题
  | "prioritization" // 资源排序题
  | "dilemma" // 两难抉择题
  | "case_analysis"; // 案例分析题

export type GroupTopic = {
  type: GroupTopicType;
  title: string; // 题干
  background: string; // 背景材料
  examineDimensions: string[]; // 3-4 个隐含考察维度(供报告对照)
};

// ---------- 阶段 ----------
export type GroupPhase =
  | "opening" // HR 开场
  | "thinking" // 读题思考
  | "statements" // 个人陈述
  | "discussion" // 自由讨论
  | "wrapup" // 收尾共识
  | "electing" // 推选汇报人
  | "reporting" // 代表汇报
  | "finished"; // 结束(可生成报告)

// ---------- 发言 ----------
export type GroupTurnKind =
  | "host" // HR 主持发言
  | "statement" // 个人陈述
  | "speech" // 自由讨论发言
  | "report"; // 代表汇报

// director 给出的发言意图
export type SpeechIntent =
  | "open" // 开场抛框架
  | "build_on" // 承接补充
  | "challenge" // 反驳/质疑
  | "summarize" // 归纳总结
  | "cue_quiet" // 点名沉默者
  | "wrap_up" // 收口
  | "statement"; // 个人陈述

export type GroupTurn = {
  index: number;
  speakerId: string;
  speakerName: string;
  kind: GroupTurnKind;
  intent?: SpeechIntent;
  referTo?: string[]; // 承接了哪些 speakerId
  text: string;
  ts: number;
};

// ---------- 配置 ----------
export type GroupDurations = {
  thinkSec: number; // 读题思考(默认 120)
  statementSecPerPerson: number; // 个人陈述每人(默认 120)
  discussSec: number; // 自由讨论(默认 360)
  reportSec: number; // 代表汇报(默认 180)
};

export const DEFAULT_GROUP_DURATIONS: GroupDurations = {
  thinkSec: 120,
  statementSecPerPerson: 120,
  discussSec: 360,
  reportSec: 180,
};

export const GROUP_AI_STUDENT_COUNT = 4; // 固定 4 名 AI 同学 + 用户 = 5 人

// ---------- 报告 ----------
export const GROUP_REPORT_DIMENSIONS = [
  "观点质量",
  "倾听与总结",
  "推动与控场",
  "协作与尊重",
  "抢答时机",
  "汇报表达",
] as const;

export type GroupDimension = (typeof GROUP_REPORT_DIMENSIONS)[number];

export type GroupReportKeyMoment = {
  turnIndex: number;
  comment: string;
};

// 逐条批注(只针对用户本人的发言)——与一对一的 RoundReview / AnswerAnnotation 同构，
// 但用 turnIndex 指向 transcript 中用户的那条发言。
export type GroupAnnotationStatus = "pending" | "running" | "ready" | "failed";

export type GroupTurnReview = {
  turnIndex: number;
  overallComment: string;
  mainStrength?: string;
  mainIssue?: string;
  nextStep?: string;
};

export type GroupTurnAnnotationType =
  | "strength"
  | "weakness"
  | "suggestion"
  | "clarity"
  | "missing";

export type GroupTurnAnnotationSeverity = "low" | "medium" | "high";

export type GroupTurnAnnotation = {
  id: string;
  turnIndex: number;
  start: number;
  end: number;
  quote: string;
  type: GroupTurnAnnotationType;
  dimensions: GroupDimension[];
  comment: string;
  suggestion?: string;
  severity: GroupTurnAnnotationSeverity;
};

export type GroupReport = {
  // 个人视角
  personal: {
    overallScore: number;
    roleTag: string; // 本场你更像: 领导者/总结者/贡献者/边缘者
    dimensions: Partial<Record<GroupDimension, ReportDimensionDetail>>;
    strengths: string[];
    weaknesses: string[];
    advice: string[];
    keyMoments: GroupReportKeyMoment[];
  };
  // 群体视角
  group: {
    summary: string;
    consensus: string[];
    disagreements: string[];
    collaborationScore: number;
    reportQuality: string;
  };
  // 面试官视角(纯报告呈现，无实时交互)
  leaderFeedback: string;
  // 逐条批注(用户发言)——与主报告分开、逐条流式生成
  turnReviews?: GroupTurnReview[];
  turnAnnotations?: GroupTurnAnnotation[];
  annotationStatus?: GroupAnnotationStatus;
  annotationStartedAt?: number;
  annotationFinishedAt?: number;
  annotationError?: string;
};

// ---------- 会话 ----------
export type GroupSessionStatus = "created" | "in_progress" | "finished";
export type ReporterKind = "user" | "ai" | null;

export type GroupInterviewSession = {
  id: string;
  ownerId: string;
  // 输入
  resume: string;
  company: string;
  jobTitle: string;
  jd: string;
  language: Language;
  // 配置
  difficulty: Difficulty;
  durations: GroupDurations;
  provider: string;
  model: string;
  thinkingEnabled: boolean;
  voice: VoiceSettings;
  // 生成内容
  topic: GroupTopic;
  members: GroupMember[]; // 含 user + students(+ host/leader 角色卡)
  // 过程
  phase: GroupPhase;
  transcript: GroupTurn[];
  reporterId: string | null;
  reporterKind: ReporterKind;
  // 产出
  report: GroupReport | null;
  status: GroupSessionStatus;
  createdAt: number;
};

// ============================================================
// 调度器(director)契约
// ============================================================

export type DirectorDecision = {
  nextSpeaker: string; // member id ("user" 或 "student_n")
  intent: SpeechIntent;
  referToSpeakers: string[]; // 应承接/总结的 speakerId
  reason: string;
  shouldPromptUser: boolean; // 是否高亮提示"该你发言了"
  wrapUp: boolean; // 是否进入收口
};

// ============================================================
// 讨论循环：每回合 POST /turn 的响应(判别联合)
// 与现有一对一面试的「每回合 POST /answer」范式一致：
// 客户端轮流调用 /turn 推进 AI 发言，遇到 your_turn 暂停等用户 /speak，
// phase_done 表示当前阶段结束、应推进。倒计时与「等用户」由客户端编排。
// ============================================================

export type GroupTurnResponse =
  | { kind: "turn"; turn: GroupTurn; promptUser: boolean }
  | { kind: "your_turn"; phase: GroupPhase; reason: string }
  | { kind: "phase_done"; nextPhase: GroupPhase };
