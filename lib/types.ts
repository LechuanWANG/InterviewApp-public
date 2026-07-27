import type { Persona, Difficulty } from "./personas";

export type InterviewMode = "simulate" | "practice";
export type InterviewType = "hr" | "technical" | "behavioral" | "mixed";
export type Language = "zh" | "en";
export type { Persona, Difficulty } from "./personas";

export type InterviewPlan = {
  focusAreas: string[];
  plannedQuestions: string[];
  openingQuestion: string;
  council?: InterviewPlanCouncil;
};

export type InterviewPlanCouncil = {
  experts: {
    role: string;
    conclusion: string;
    keyFindings: string[];
  }[];
  consensus: {
    summary: string;
    priorityTopics: {
      order?: number;
      topic: string;
      priority: "high" | "medium" | "low";
      reason: string;
      source: ("jd" | "resume" | "risk" | "strategy")[];
      mainQuestion?: string;
      followUpGoals?: string[];
      exitCriteria?: string[];
    }[];
    predictedRisks: {
      risk: string;
      whyItMatters: string;
      verificationQuestion: string;
    }[];
    disagreements: {
      issue: string;
      positions: string[];
      finalDecision: string;
    }[];
    candidateBrief?: {
      interviewRhythm: string;
      answerAdvice: string;
    };
    resolutionLog?: {
      expert: string;
      concern: string;
      action: string;
      status: "approved" | "resolved" | "adjudicated";
    }[];
    questionIntents?: {
      question: string;
      purpose: string;
      raisedBy: string;
      relatedTopics: string[];
    }[];
  };
};

export type Round = {
  question: string;
  answer: string;
  isFollowUp: boolean;
  timedOut?: boolean;
};

export type SessionStatus = "created" | "in_progress" | "finished";

export type Session = {
  id: string;
  ownerId: string;
  resume: string;
  company: string;
  jobTitle: string;
  jd: string;
  interviewType: InterviewType;
  language: Language;
  persona: Persona;
  difficulty: Difficulty;
  mode: InterviewMode;
  provider: string;
  model: string;
  thinkingEnabled: boolean;
  plan: InterviewPlan | null;
  rounds: Round[];
  currentQuestion: string | null;
  currentIsFollowUp: boolean;
  status: SessionStatus;
  report: Report | null;
  createdAt: number;
};

export type NextAction = {
  action: "followup" | "next" | "end";
  question: string;
  rationale?: string;
};

export const REPORT_DIMENSIONS = [
  "岗位匹配度",
  "回答完整度",
  "逻辑表达清晰度",
  "业务理解与价值表达",
  "关键能力可信度",
] as const;

export type ReportDimension = (typeof REPORT_DIMENSIONS)[number];

export const REPORT_WEIGHTS: Record<ReportDimension, number> = {
  岗位匹配度: 0.2,
  回答完整度: 0.2,
  逻辑表达清晰度: 0.2,
  业务理解与价值表达: 0.2,
  关键能力可信度: 0.2,
};

export const LEGACY_REPORT_DIMENSIONS = [
  "岗位匹配度",
  "回答完整度",
  "逻辑性",
  "专业度",
  "沟通表达",
] as const;

export type LegacyReportDimension = (typeof LEGACY_REPORT_DIMENSIONS)[number];

export type ReportDimensionDetail = {
  score: number;
  evidence: string[];
  reason: string;
  advice: string;
};

export type ReportPenalty = {
  type: string;
  points: number;
  roundIndex?: number;
  reason: string;
};

export type MbtiLetter = "E" | "I" | "S" | "N" | "T" | "F" | "J" | "P";
export type MbtiAxis = "EI" | "SN" | "TF" | "JP";

export type MbtiAxisDetail = {
  axis: MbtiAxis;
  left: MbtiLetter;
  right: MbtiLetter;
  selected: MbtiLetter;
  tendency: number;
  evidence: string[];
  reason: string;
};

export type MbtiReport = {
  mbtiType: string;
  confidence: number;
  summary: string;
  axes: Record<MbtiAxis, MbtiAxisDetail>;
  strengths: string[];
  risks: string[];
  jobMatches: string[];
};

export type AnswerAnnotationType =
  | "strength"
  | "weakness"
  | "suggestion"
  | "clarity"
  | "missing"
  | "mbti_evidence";

export type AnswerAnnotationSeverity = "low" | "medium" | "high";

export type AnswerAnnotation = {
  id: string;
  roundIndex: number;
  start: number;
  end: number;
  quote: string;
  type: AnswerAnnotationType;
  dimensions: ReportDimension[];
  mbtiLetters?: MbtiLetter[];
  comment: string;
  suggestion?: string;
  severity: AnswerAnnotationSeverity;
};

export type RoundAnnotationSummary = {
  roundIndex: number;
  strengths: number;
  weaknesses: number;
  suggestions: number;
  mbtiEvidence?: number;
};

export type RoundReview = {
  roundIndex: number;
  overallComment: string;
  mainStrength?: string;
  mainIssue?: string;
  nextStep?: string;
};

export type ReportAnnotationStatus = "pending" | "running" | "ready" | "failed";

export type TopicCoverageStatus = "covered" | "partial" | "uncovered";

export type TopicCoverageReport = {
  summary: string;
  coverageRate: number;
  topics: {
    topic: string;
    priority: "high" | "medium" | "low";
    status: TopicCoverageStatus;
    evidence: string;
    relatedRounds: number[];
    nextStep: string;
  }[];
  schedulingNote: string;
};

export type Report = {
  reportKind?: "score" | "mbti";
  annotationStatus?: ReportAnnotationStatus;
  annotationStartedAt?: number;
  annotationFinishedAt?: number;
  annotationError?: string;
  overallBand: number;
  overallScore: number;
  rawOverall: number;
  penalty: number;
  difficultyAdjustment: number;
  weights: Record<ReportDimension, number>;
  dimensionScores: Record<ReportDimension, number>;
  categoryScores: Record<ReportDimension, number>;
  dimensionDetails: Partial<Record<ReportDimension, ReportDimensionDetail>>;
  penalties: ReportPenalty[];
  roundReviews: RoundReview[];
  answerAnnotations: AnswerAnnotation[];
  annotationSummaries: RoundAnnotationSummary[];
  strengths: string[];
  weaknesses: string[];
  improvementAdvice: string[];
  betterAnswers: { question: string; suggested: string }[];
  mbtiReport?: MbtiReport | null;
  topicCoverage?: TopicCoverageReport | null;
};

export const MAX_ROUNDS = 8;
