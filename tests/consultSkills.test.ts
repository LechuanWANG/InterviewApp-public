import assert from "node:assert/strict";
import test from "node:test";
import { selectConsultSkills } from "../lib/consultation/consultSkills";
import type { InterviewHistoryRecord } from "../lib/historyStore";

const baseRecord = {
  id: "record-1",
  ownerId: "test-user",
  sessionId: "session-1",
  resume: "双非本科，市场营销专业，想转产品运营。",
  company: "字节跳动",
  jobTitle: "产品运营培训生",
  jd: "负责产品运营、用户增长、数据分析。",
  interviewType: "mixed" as const,
  language: "zh" as const,
  persona: "warm_hr" as const,
  difficulty: "medium" as const,
  mode: "practice" as const,
  rounds: [],
  report: {
    reportKind: "score" as const,
    overallBand: 4,
    overallScore: 4,
    rawOverall: 4,
    penalty: 0,
    difficultyAdjustment: 0,
    weights: {
      岗位匹配度: 0.2,
      回答完整度: 0.2,
      逻辑表达清晰度: 0.2,
      业务理解与价值表达: 0.2,
      关键能力可信度: 0.2,
    },
    dimensionScores: {
      岗位匹配度: 3,
      回答完整度: 4,
      逻辑表达清晰度: 4,
      业务理解与价值表达: 3,
      关键能力可信度: 4,
    },
    categoryScores: {
      岗位匹配度: 3,
      回答完整度: 4,
      逻辑表达清晰度: 4,
      业务理解与价值表达: 3,
      关键能力可信度: 4,
    },
    dimensionDetails: {},
    penalties: [],
    roundReviews: [],
    answerAnnotations: [],
    annotationSummaries: [],
    strengths: ["表达比较自然"],
    weaknesses: ["岗位认知不清", "项目证据不足"],
    improvementAdvice: ["补充数据分析案例"],
    betterAnswers: [],
  },
  createdAt: 1,
  reportedAt: 2,
} satisfies InterviewHistoryRecord;

test("selects peer-experience and direction skills for low-confidence career change questions", () => {
  const skills = selectConsultSkills({
    records: [baseRecord],
    goal: "direction_judgement",
    userMessage: "我是双非背景，专业不对口，想转产品但很焦虑。",
  });

  assert.ok(skills.includes("peer_experience"));
  assert.ok(skills.includes("choice_over_effort"));
  assert.ok(skills.includes("role_direction"));
});

test("selects AI-era and irreplacability skills for automation concerns", () => {
  const skills = selectConsultSkills({
    records: [baseRecord],
    goal: "practice_plan",
    userMessage: "AI 大模型会不会替代产品运营？我应该怎么准备？",
  });

  assert.ok(skills.includes("ai_era_lens"));
  assert.ok(skills.includes("irreplacability_test"));
  assert.ok(skills.includes("practice_plan"));
});

test("selects pace warning when user is trying to prepare every direction at once", () => {
  const skills = selectConsultSkills({
    records: [baseRecord],
    goal: "common_issues",
    userMessage: "我最近压力很大，想同时准备产品、运营、市场，每天熬夜但感觉来不及。",
  });

  assert.ok(skills.includes("health_pace_warning"));
  assert.ok(skills.includes("choice_over_effort"));
  assert.ok(skills.includes("social_filter"));
});

test("drops capability skills when no interview records are retrieved", () => {
  const skills = selectConsultSkills({
    records: [],
    goal: "common_issues",
    userMessage: "帮我看看我这几场面试的共性问题。",
  });

  assert.ok(!skills.some((id) => id.startsWith("record_")));
});
