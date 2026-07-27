import type { InterviewHistoryRecord } from "../historyStore";

export type ConsultSummaryMode = "single_session" | "multi_session";
export type ConsultStatus = "active" | "stopped" | "completed";
export type ConsultEndedBy = "user_click" | "user_voice" | "ai_completed" | null;
export type ConsultMemorySaveStatus = "pending" | "saved" | "excluded";
export type ConsultTopic =
  | "job_direction"
  | "job_motivation"
  | "project_depth"
  | "expression_logic"
  | "evidence_results"
  | "practice_plan"
  | "resume_background"
  | "team_communication";
export type ConsultGoal =
  | "common_issues"
  | "direction_judgement"
  | "practice_plan"
  | "single_review"
  | "open_chat";

export type ConsultMessage = {
  id: string;
  ownerId?: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
};

export type ConsultSummary = {
  currentJudgement: string;
  primaryTarget: string;
  notRecommended: string[];
  repeatedIssues: string[];
  nextPracticeFocus: string[];
  sevenDayPlan: string[];
};

export type ConsultTopicStat = {
  topic: ConsultTopic;
  label: string;
  count: number;
};

export type ConsultMemorySourceItem = {
  type: "user_profile" | "interview_evidence" | "consultation_memory" | "common_issues";
  content: string;
  sourceTitle: string | null;
  quoteOrSummary: string | null;
  confidence: number;
  tags: string[];
  lastSeenAt: number;
};

export type ConsultMemoryProfile = {
  ownerId: string;
  profileId: string;
  version: number;
  compactSummary: string;
  currentTarget: string | null;
  avoidTargets: string[];
  stableStrengths: string[];
  recurringIssues: string[];
  resolvedIssues: string[];
  practiceFocus: string[];
  recentShift: string | null;
  evidenceRefs: string[];
  sourceSessionCount: number;
  lastCompactedSessionId: string | null;
  updatedAt: number;
};

export type ConsultMemoryGraphNodeType =
  | "profile"
  | "target"
  | "avoid_target"
  | "strength"
  | "risk"
  | "resolved_issue"
  | "practice_focus"
  | "topic"
  | "evidence";

export type ConsultMemoryGraphNodeStatus =
  | "active"
  | "resolved"
  | "archived"
  | "superseded";

export type ConsultMemoryGraphRelationType =
  | "contains"
  | "supports"
  | "causes"
  | "conflicts_with"
  | "improves"
  | "evidenced_by"
  | "next_step";

export type ConsultMemoryGraphNode = {
  id: string;
  ownerId: string;
  profileId: string;
  type: ConsultMemoryGraphNodeType;
  label: string;
  summary: string;
  weight: number;
  status: ConsultMemoryGraphNodeStatus;
  sourceSessionIds: string[];
  evidenceRefs: string[];
  createdAt: number;
  updatedAt: number;
  lastSeenAt: number;
};

export type ConsultMemoryGraphEdge = {
  id: string;
  ownerId: string;
  profileId: string;
  sourceNodeId: string;
  targetNodeId: string;
  relationType: ConsultMemoryGraphRelationType;
  weight: number;
  createdAt: number;
  updatedAt: number;
};

export type ConsultMemoryGraphSnapshot = {
  nodes: ConsultMemoryGraphNode[];
  edges: ConsultMemoryGraphEdge[];
  sourceSessionCount: number;
  summary: string | null;
  updatedAt: number | null;
};

export type ConsultMemorySnapshot = {
  profileId: string;
  pastSessionCount: number;
  compactProfile?: ConsultMemoryProfile | null;
  graph?: ConsultMemoryGraphSnapshot | null;
  sourceItems?: ConsultMemorySourceItem[];
  latestJudgement: string | null;
  latestPrimaryTarget: string | null;
  targetRoles: string[];
  avoidRoles: string[];
  repeatedIssues: string[];
  recentAdvice: string[];
  discussedTopics: ConsultTopicStat[];
  recentQuestions: string[];
  updatedAt: number | null;
};

export type ConsultSession = {
  id: string;
  ownerId: string;
  selectedInterviewSessionIds: string[];
  summaryMode: ConsultSummaryMode;
  goal: ConsultGoal;
  mentorType: "career_strategist";
  memoryProfileId: string;
  memoryEnabled: boolean;
  memorySaveStatus?: ConsultMemorySaveStatus;
  provider: string;
  model: string;
  status: ConsultStatus;
  endedBy: ConsultEndedBy;
  records: InterviewHistoryRecord[];
  messages: ConsultMessage[];
  summary: ConsultSummary | null;
  createdAt: number;
  updatedAt: number;
  endedAt?: number;
};
