import assert from "node:assert/strict";
import test from "node:test";
import { buildConsultMemoryIssues, markIssueResolved } from "../lib/consultation/issues";
import {
  buildConsultMemoryDigest,
  buildConsultMemorySnapshot,
  buildConversationCoverageDigest,
  DEFAULT_CONSULT_PROFILE_ID,
} from "../lib/consultation/memory";
import { inferConsultDialogueIntent } from "../lib/consultation/intent";
import { extractConsultMemoryItemsFromSession } from "../lib/consultation/memoryItems";
import { buildMemoryContributionSession } from "../lib/consultation/memoryCoverage";
import type { ConsultSession } from "../lib/consultation/types";
import type { InterviewHistoryRecord } from "../lib/historyStore";

const hasSupabase = (): boolean => !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

const baseRecord = {
  id: "record-1",
  ownerId: "test-user",
  sessionId: "record-1",
  resume: "简历",
  company: "字节跳动",
  jobTitle: "产品运营培训生",
  jd: "JD",
  interviewType: "mixed" as const,
  language: "zh" as const,
  persona: "warm_hr" as const,
  difficulty: "medium" as const,
  mode: "practice" as const,
  rounds: [],
  report: {
    reportKind: "score" as const,
    overallBand: 3.5,
    overallScore: 3.5,
    rawOverall: 3.5,
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
      回答完整度: 3,
      逻辑表达清晰度: 3,
      业务理解与价值表达: 3,
      关键能力可信度: 3,
    },
    categoryScores: {
      岗位匹配度: 3,
      回答完整度: 3,
      逻辑表达清晰度: 3,
      业务理解与价值表达: 3,
      关键能力可信度: 3,
    },
    dimensionDetails: {},
    penalties: [],
    roundReviews: [
      {
        roundIndex: 1,
        overallComment: "岗位动机比较弱，项目深度也不够。",
        mainIssue: "表达一般，证据不够。",
      },
    ],
    answerAnnotations: [],
    annotationSummaries: [],
    strengths: [],
    weaknesses: ["岗位动机偏弱", "项目结果证据不足"],
    improvementAdvice: ["补充量化结果"],
    betterAnswers: [],
  },
  createdAt: 1,
  reportedAt: 2,
} satisfies InterviewHistoryRecord;

function makeSession(overrides: Partial<ConsultSession>): ConsultSession {
  return {
    id: overrides.id || "consult-1",
    ownerId: "test-user",
    selectedInterviewSessionIds: ["record-1"],
    summaryMode: "single_session",
    goal: "single_review",
    mentorType: "career_strategist",
    memoryProfileId: DEFAULT_CONSULT_PROFILE_ID,
    memoryEnabled: true,
    provider: "deepseek",
    model: "deepseek-reasoner",
    status: "completed",
    endedBy: "user_click",
    records: [baseRecord],
    messages: [],
    summary: null,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

test("builds cross-session memory snapshot from completed consultations", { skip: !hasSupabase() }, async () => {
  const sessions: ConsultSession[] = [
    makeSession({
      id: "consult-1",
      messages: [
        {
          id: "m1",
          role: "assistant",
          content: "我先问你一个核心问题：你为什么投产品运营培训生？",
          createdAt: 10,
        },
        {
          id: "m2",
          role: "user",
          content: "我主要是想系统学习运营，也想看大厂平台。",
          createdAt: 11,
        },
      ],
      summary: {
        currentJudgement: "目标方向还不够收敛。",
        primaryTarget: "优先主攻产品运营培训生",
        notRecommended: ["暂时不要同时分散投市场和销售"],
        repeatedIssues: ["岗位动机偏被动", "项目结果讲得不够硬"],
        nextPracticeFocus: ["先把岗位动机讲具体", "补一个项目结果案例"],
        sevenDayPlan: ["重写自我介绍", "补充量化结果"],
      },
      createdAt: 10,
      updatedAt: 20,
      endedAt: 20,
    }),
    makeSession({
      id: "consult-2",
      messages: [
        {
          id: "m3",
          role: "assistant",
          content: "你项目里到底做了什么，拿什么证明结果？",
          createdAt: 30,
        },
      ],
      summary: {
        currentJudgement: "项目深度和证据链仍然是核心短板。",
        primaryTarget: "继续围绕产品运营岗位打磨",
        notRecommended: ["不要继续海投完全无关岗位"],
        repeatedIssues: ["项目深挖不够", "缺少量化结果"],
        nextPracticeFocus: ["练项目追问", "补结果指标"],
        sevenDayPlan: ["整理项目 STAR", "准备两段量化案例"],
      },
      createdAt: 30,
      updatedAt: 40,
      endedAt: 40,
    }),
  ];

  const snapshot = await buildConsultMemorySnapshot({ sessions, profileId: DEFAULT_CONSULT_PROFILE_ID });

  assert.equal(snapshot.pastSessionCount, 2);
  assert.equal(snapshot.latestJudgement, "项目深度和证据链仍然是核心短板。");
  assert.ok(snapshot.targetRoles.some((item) => item.includes("产品运营")));
  assert.ok(snapshot.avoidRoles.some((item) => item.includes("无关岗位")));
  assert.ok(snapshot.repeatedIssues.some((item) => item.includes("项目")));
  assert.ok(snapshot.recentQuestions.some((item) => item.includes("为什么投产品运营培训生")));
  assert.ok(snapshot.discussedTopics.some((item) => item.label === "岗位方向"));
});

test("memory snapshot ignores consultations with memory disabled", { skip: !hasSupabase() }, async () => {
  const snapshot = await buildConsultMemorySnapshot({
    sessions: [
      makeSession({
        id: "memory-off",
        memoryEnabled: false,
        summary: {
          currentJudgement: "这条不应该进入记忆。",
          primaryTarget: "不应记住的方向",
          notRecommended: ["不应记住的风险"],
          repeatedIssues: ["不应记住的问题"],
          nextPracticeFocus: ["不应记住的建议"],
          sevenDayPlan: ["不应记住的计划"],
        },
      }),
    ],
    profileId: DEFAULT_CONSULT_PROFILE_ID,
  });

  assert.equal(snapshot.pastSessionCount, 0);
  assert.equal(snapshot.latestJudgement, null);
  assert.deepEqual(snapshot.repeatedIssues, []);
});

test("memory snapshot only uses consultations explicitly saved to memory", { skip: !hasSupabase() }, async () => {
  const snapshot = await buildConsultMemorySnapshot({
    sessions: [
      makeSession({
        id: "pending-memory",
        memorySaveStatus: "pending",
        summary: {
          currentJudgement: "待选择的不应进入记忆。",
          primaryTarget: "待选择方向",
          notRecommended: [],
          repeatedIssues: ["待选择问题"],
          nextPracticeFocus: [],
          sevenDayPlan: [],
        },
      }),
      makeSession({
        id: "excluded-memory",
        memorySaveStatus: "excluded",
        summary: {
          currentJudgement: "不保存的不应进入记忆。",
          primaryTarget: "不保存方向",
          notRecommended: [],
          repeatedIssues: ["不保存问题"],
          nextPracticeFocus: [],
          sevenDayPlan: [],
        },
      }),
      makeSession({
        id: "saved-memory",
        memorySaveStatus: "saved",
        summary: {
          currentJudgement: "保存的应该进入记忆。",
          primaryTarget: "保存方向",
          notRecommended: [],
          repeatedIssues: ["保存问题"],
          nextPracticeFocus: [],
          sevenDayPlan: [],
        },
      }),
    ],
    profileId: DEFAULT_CONSULT_PROFILE_ID,
  });

  assert.equal(snapshot.pastSessionCount, 1);
  assert.equal(snapshot.latestJudgement, "保存的应该进入记忆。");
  assert.deepEqual(snapshot.repeatedIssues, ["保存问题"]);
});

test("memory snapshot can include current saved consultation when not explicitly excluded", { skip: !hasSupabase() }, async () => {
  const session = makeSession({
    id: "current-saved",
    status: "active",
    memorySaveStatus: "saved",
    summary: {
      currentJudgement: "当前这场也应该展示在记忆栏。",
      primaryTarget: "继续主攻产品运营",
      notRecommended: [],
      repeatedIssues: ["岗位动机偏泛"],
      nextPracticeFocus: ["补岗位理解"],
      sevenDayPlan: ["重写岗位动机"],
    },
  });

  const included = await buildConsultMemorySnapshot({
    sessions: [session],
    profileId: DEFAULT_CONSULT_PROFILE_ID,
  });
  const excluded = await buildConsultMemorySnapshot({
    sessions: [session],
    currentSessionId: session.id,
    profileId: DEFAULT_CONSULT_PROFILE_ID,
  });

  assert.equal(included.pastSessionCount, 1);
  assert.equal(included.latestJudgement, "当前这场也应该展示在记忆栏。");
  assert.equal(excluded.pastSessionCount, 0);
});

test("memory snapshot excludes issues that user marked as resolved", { skip: !hasSupabase() }, async () => {
  await markIssueResolved({
    normalizedKey: "岗位动机偏被动",
    label: "岗位动机偏被动",
    profileId: DEFAULT_CONSULT_PROFILE_ID,
  });

  const snapshot = await buildConsultMemorySnapshot({
    sessions: [
      makeSession({
        id: "resolved-issue-session",
        memorySaveStatus: "saved",
        summary: {
          currentJudgement: "岗位动机和项目证据都需要继续补。",
          primaryTarget: "产品运营培训生",
          notRecommended: [],
          repeatedIssues: ["岗位动机偏被动", "项目结果讲得不够硬"],
          nextPracticeFocus: ["岗位动机偏被动", "补一个项目结果案例"],
          sevenDayPlan: ["岗位动机偏被动", "整理项目 STAR"],
        },
      }),
    ],
    profileId: DEFAULT_CONSULT_PROFILE_ID,
  });

  assert.deepEqual(snapshot.repeatedIssues, ["项目结果讲得不够硬"]);
  assert.ok(!snapshot.recentAdvice.includes("岗位动机偏被动"));
  assert.ok(snapshot.recentAdvice.includes("补一个项目结果案例"));
});

test("issue aggregation only keeps recurring issues from consultation summaries", { skip: !hasSupabase() }, async () => {
  const issues = await buildConsultMemoryIssues({
    sessions: [
      makeSession({
        id: "consult-with-record",
        records: [baseRecord],
        summary: {
          currentJudgement: "岗位动机需要继续打磨。",
          primaryTarget: "产品运营培训生",
          notRecommended: [],
          repeatedIssues: ["岗位动机偏被动"],
          nextPracticeFocus: ["补充量化结果"],
          sevenDayPlan: [],
        },
        memorySaveStatus: "saved",
      }),
    ],
    interviewRecords: [baseRecord],
    profileId: DEFAULT_CONSULT_PROFILE_ID,
  });

  assert.deepEqual(issues.commonIssues.map((item) => item.label), ["岗位动机偏被动"]);
  assert.deepEqual(issues.singleInterviewIssues, []);
  assert.ok(!issues.commonIssues.some((item) => item.label === "补充量化结果"));
  assert.ok(!issues.commonIssues.some((item) => item.label === "岗位动机偏弱"));
});

test("memory digest tells model not to repeat prior questions", async () => {
  const digest = buildConsultMemoryDigest(
    await buildConsultMemorySnapshot({
      sessions: [
        makeSession({
          messages: [
            {
              id: "m1",
              role: "assistant",
              content: "你为什么投这个岗位？",
              createdAt: 10,
            },
          ],
          summary: {
            currentJudgement: "方向不清楚。",
            primaryTarget: "先收敛到产品运营",
            notRecommended: ["暂时不要乱投"],
            repeatedIssues: ["岗位动机太泛"],
            nextPracticeFocus: ["重写岗位动机"],
            sevenDayPlan: ["梳理理由"],
          },
        }),
      ],
      profileId: DEFAULT_CONSULT_PROFILE_ID,
    })
  );

  assert.match(digest, /最近已经追问过的问题/);
  assert.match(digest, /用户当前问题优先级最高/);
  assert.match(digest, /不要.*原样.*拉回当前对话/);
});

test("extracts typed memory items from completed consultation summary", () => {
  const session = makeSession({
    id: "structured-memory",
    memorySaveStatus: "saved",
    messages: [
      {
        id: "m1",
        role: "assistant",
        content: "你为什么投这个岗位？",
        createdAt: 10,
      },
    ],
    summary: {
      currentJudgement: "项目深度和岗位动机仍是核心短板。",
      primaryTarget: "继续主攻数据分析实习",
      notRecommended: ["暂时不要分散投完全无关岗位"],
      repeatedIssues: ["岗位动机偏泛", "项目结果证据不足"],
      nextPracticeFocus: ["练业务归因和结果量化"],
      sevenDayPlan: ["重写一个核心项目 STAR"],
    },
  });

  const items = extractConsultMemoryItemsFromSession(session);
  assert.ok(items.some((item) => item.type === "common_issues" && item.content === "岗位动机偏泛"));
  assert.ok(items.some((item) => item.type === "user_profile" && item.tags.includes("target_role")));
  assert.ok(items.some((item) => item.type === "consultation_memory" && item.tags.includes("asked_question")));
  assert.ok(items.every((item) => item.sourceId === "structured-memory"));
});

test("memory digest includes structured evidence when source items exist", () => {
  const digest = buildConsultMemoryDigest({
    profileId: DEFAULT_CONSULT_PROFILE_ID,
    pastSessionCount: 1,
    sourceItems: [
      {
        type: "common_issues",
        content: "岗位动机偏泛",
        sourceTitle: "数据分析实习 · 字节跳动",
        quoteOrSummary: "战略咨询识别出的反复问题：岗位动机偏泛",
        confidence: 0.9,
        tags: ["repeated_issue"],
        lastSeenAt: 10,
      },
    ],
    latestJudgement: "方向需要收敛。",
    latestPrimaryTarget: "数据分析实习",
    targetRoles: ["数据分析实习"],
    avoidRoles: [],
    repeatedIssues: ["岗位动机偏泛"],
    recentAdvice: [],
    discussedTopics: [],
    recentQuestions: [],
    updatedAt: 10,
  });

  assert.match(digest, /结构化记忆证据/);
  assert.match(digest, /共性问题/);
  assert.match(digest, /岗位动机偏泛/);
  assert.match(digest, /用户当前问题优先级最高/);
});

test("memory contribution ignores repeated consultations for the same interview", () => {
  const previous = makeSession({
    id: "consult-old",
    summary: {
      currentJudgement: "旧咨询已经覆盖这场面试。",
      primaryTarget: "产品运营",
      notRecommended: [],
      repeatedIssues: ["项目结果证据不足"],
      nextPracticeFocus: [],
      sevenDayPlan: [],
    },
  });
  const current = makeSession({
    id: "consult-repeat",
    summary: {
      currentJudgement: "再次咨询同一场面试。",
      primaryTarget: "产品运营",
      notRecommended: [],
      repeatedIssues: ["项目结果证据不足"],
      nextPracticeFocus: [],
      sevenDayPlan: [],
    },
  });

  assert.equal(buildMemoryContributionSession(current, [previous]), null);
});

test("memory contribution keeps only newly selected interviews", () => {
  const secondRecord: InterviewHistoryRecord = {
    ...baseRecord,
    id: "record-2",
    sessionId: "session-2",
    company: "腾讯",
    jobTitle: "数据分析实习生",
  };
  const previous = makeSession({
    id: "consult-old",
    summary: {
      currentJudgement: "旧咨询已经覆盖第一场面试。",
      primaryTarget: "产品运营",
      notRecommended: [],
      repeatedIssues: ["项目结果证据不足"],
      nextPracticeFocus: [],
      sevenDayPlan: [],
    },
  });
  const current = makeSession({
    id: "consult-mixed",
    selectedInterviewSessionIds: ["record-1", "record-2"],
    summaryMode: "multi_session",
    records: [baseRecord, secondRecord],
    summary: {
      currentJudgement: "这次咨询混合了旧面试和新面试。",
      primaryTarget: "数据分析实习",
      notRecommended: [],
      repeatedIssues: ["项目结果证据不足"],
      nextPracticeFocus: [],
      sevenDayPlan: [],
    },
  });

  const contribution = buildMemoryContributionSession(current, [previous]);

  assert.ok(contribution);
  assert.deepEqual(contribution.records.map((record) => record.id), ["record-2"]);
  assert.deepEqual(contribution.selectedInterviewSessionIds, ["record-2"]);
});

test("consult dialogue intent prioritizes user-led questions", () => {
  assert.equal(inferConsultDialogueIntent("我现在该主攻后端还是数据分析？"), "decision_help");
  assert.equal(inferConsultDialogueIntent("下一周我该怎么练？"), "plan_request");
  assert.equal(inferConsultDialogueIntent("帮我复盘这段回答"), "review_request");
  assert.equal(inferConsultDialogueIntent("我最近很焦虑，不知道怎么办"), "emotion_or_confusion");
  assert.equal(inferConsultDialogueIntent("我反复暴露的问题是什么？"), "diagnostic_request");
  assert.equal(inferConsultDialogueIntent("这个岗位还要继续投吗？"), "decision_help");
});

test("conversation coverage digest reflects current topics and asked questions", () => {
  const digest = buildConversationCoverageDigest([
    {
      id: "m1",
      role: "assistant",
      content: "你为什么投这个岗位？",
      createdAt: 1,
    },
    {
      id: "m2",
      role: "user",
      content: "我想做产品运营，也想提升表达和项目复盘能力。",
      createdAt: 2,
    },
  ]);

  assert.match(digest, /当前会话已覆盖话题/);
  assert.match(digest, /岗位方向/);
  assert.match(digest, /逻辑表达/);
  assert.match(digest, /已经问过的问题/);
});
