import type { InterviewPlanCouncil } from "@/lib/types";

export type CouncilDraft = {
  resume: string;
  company: string;
  jobTitle: string;
  jd: string;
  interviewType: string;
  language: "zh" | "en";
  modelId: string;
  thinkingEnabled: boolean;
  persona: string;
  difficulty: string;
  mode: "simulate" | "practice";
};

/** 智囊团动画页只需读取以下字段用于展示，其余字段原样透传给后端。 */
export type CouncilPageDraft = {
  company: string;
  jobTitle: string;
  language: "zh" | "en";
  modelId: string;
  [key: string]: unknown;
};

/** 让智囊团动画页可在一对一 / 群面之间复用的配置。 */
export type CouncilVariant = {
  /** sessionStorage 中草稿的 key */
  draftKey: string;
  /** 合议流式接口 */
  streamEndpoint: string;
  /** 合议完成后进入会话的路由前缀，如 "/interview/" 或 "/group/" */
  sessionRoutePrefix: string;
  /** 出错时「快速开始」走的非合议接口 */
  fastEndpoint: string;
  /** 由草稿构造「快速开始」请求体 */
  buildFastBody: (draft: CouncilPageDraft) => unknown;
  /** 进入会话前写入的过渡标记 key（可选） */
  transitionKey?: string;
  /** 进入会话前预加载的图片资源（可选） */
  preloadAssets?: string[];
  /** 圆桌席位的角色名（按语言）。不传则用一对一默认席位。 */
  roles?: { zh: string[]; en: string[] };
};

export type ResolutionStatus = "approved" | "resolved" | "adjudicated";

export type ResolutionLogItem = {
  expert: string;
  concern: string;
  action: string;
  status: ResolutionStatus;
};

export type CouncilResult = {
  conclusion?: string;
  keyFindings?: string[];
  focusAreas?: string[];
  satisfaction?: number;
  satisfied?: boolean;
  approved?: boolean;
  remainingConcern?: string;
  questionIdeas?: { question: string; purpose?: string }[];
  predictedRisks?: { risk: string; whyItMatters?: string }[];
  concerns?: { concern: string; resolutionHint?: string }[];
  resolutionLog?: ResolutionLogItem[];
};

export type SpeakerState = {
  role: string;
  status: "idle" | "speaking" | "done";
  count: number;
  satisfaction?: number;
  satisfied?: boolean;
  finalStatus?: ResolutionStatus;
};

export type CouncilTurn = {
  role: string;
  phase: "first" | "critique" | "revision" | "skip" | "review" | "consensus" | "fallback";
  result: CouncilResult;
};

export type TranscriptItem = {
  key: string;
  turn: CouncilTurn;
  index: number;
  exiting: boolean;
};

export type CouncilThinkingStage =
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

export type RoleThinkingStatus = {
  stage?: CouncilThinkingStage;
  message: string;
  updatedAt: number;
};

export type MeetingNote = {
  key: string;
  role?: string;
  stage?: CouncilThinkingStage;
  message: string;
  createdAt: number;
  exiting: boolean;
};

export type StreamEvent = {
  type: string;
  role?: string;
  stage?: CouncilThinkingStage;
  message?: string;
  result?: CouncilResult;
  plan?: { council?: InterviewPlanCouncil; focusAreas?: string[]; openingQuestion?: string };
  council?: InterviewPlanCouncil;
  focusAreas?: string[];
  sessionId?: string;
  question?: string;
  error?: string;
};

export type CouncilTopic = InterviewPlanCouncil["consensus"]["priorityTopics"][number];
