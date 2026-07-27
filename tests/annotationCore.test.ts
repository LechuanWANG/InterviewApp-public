import assert from "node:assert/strict";
import test from "node:test";
import {
  findQuoteRange,
  normalizeAnnotations,
  normalizeRoundReviews,
  summarizeAnnotations,
} from "../lib/prompts/annotateAnswersCore";
import type { Round } from "../lib/types";

const rounds: Pick<Round, "answer">[] = [
  {
    answer:
      "嗯，然后我在校园二手交易平台项目里负责前端页面和接口联调，最后完成了发布流程。",
  },
  {
    answer: "这个项目我没有具体参与实现，只是了解了一下大概流程。",
  },
];

test("keeps useful strength annotations and computes text ranges", () => {
  const annotations = normalizeAnnotations(
    [
      {
        roundIndex: 1,
        quote: "负责前端页面和接口联调",
        type: "strength",
        dimensions: ["回答完整度", "关键能力可信度"],
        comment: "这里说明了个人职责。",
        suggestion: "可以继续补充具体难点。",
        severity: "low",
      },
    ],
    rounds
  );

  assert.equal(annotations.length, 1);
  assert.equal(annotations[0].quote, "负责前端页面和接口联调");
  assert.equal(annotations[0].start, rounds[0].answer.indexOf("负责前端页面和接口联调"));
  assert.equal(annotations[0].end, annotations[0].start + "负责前端页面和接口联调".length);
  assert.deepEqual(annotations[0].dimensions, ["回答完整度", "关键能力可信度"]);
});

test("keeps ASR/name/terminology-related annotations when AI chooses to output them", () => {
  const annotations = normalizeAnnotations(
    [
      {
        roundIndex: 1,
        quote: "前端",
        type: "clarity",
        dimensions: ["逻辑表达清晰度"],
        comment: "这个术语可能存在语音识别偏差。",
        severity: "medium",
      },
    ],
    rounds
  );

  assert.equal(annotations.length, 1);
  assert.equal(annotations[0].type, "clarity");
});

test("keeps spoken-style annotations when AI chooses to output them", () => {
  const annotations = normalizeAnnotations(
    [
      {
        roundIndex: 1,
        quote: "嗯",
        type: "weakness",
        dimensions: ["逻辑表达清晰度"],
        comment: "这里有口语停顿词，表达不够书面。",
        suggestion: "减少嗯啊。",
        severity: "low",
      },
      {
        roundIndex: 1,
        quote: "然后",
        type: "clarity",
        dimensions: ["逻辑表达清晰度"],
        comment: "这个连接词比较口语化。",
        severity: "low",
      },
    ],
    rounds
  );

  assert.equal(annotations.length, 2);
  assert.deepEqual(
    annotations.map((item) => item.type),
    ["weakness", "clarity"]
  );
});

test("keeps real substantive weaknesses", () => {
  const annotations = normalizeAnnotations(
    [
      {
        roundIndex: 2,
        quote: "没有具体参与实现，只是了解了一下大概流程",
        type: "weakness",
        dimensions: ["回答完整度", "关键能力可信度"],
        comment: "这里说明个人参与度不足，无法证明真实贡献。",
        suggestion: "补充自己承担的具体任务或说明该经历的学习收获。",
        severity: "high",
      },
    ],
    rounds
  );

  assert.equal(annotations.length, 1);
  assert.equal(annotations[0].type, "weakness");
  assert.equal(annotations[0].severity, "high");
});

test("drops annotations whose quote does not exist in the answer", () => {
  const annotations = normalizeAnnotations(
    [
      {
        roundIndex: 1,
        quote: "这句话不在原回答里",
        type: "suggestion",
        dimensions: ["回答完整度"],
        comment: "应该被丢弃。",
        severity: "medium",
      },
    ],
    rounds
  );

  assert.equal(annotations.length, 0);
});

test("loosely matches quote when punctuation or spaces differ", () => {
  const answer = "我主要负责商品发布、商品列表和登录后的状态处理。";
  const match = findQuoteRange(answer, "负责商品发布 商品列表 和登录后的状态处理");

  assert.deepEqual(match, {
    start: answer.indexOf("负责商品发布"),
    end: answer.indexOf("状态处理") + "状态处理".length,
  });
});

test("keeps annotations when quote differs only by punctuation", () => {
  const answer = "我主要负责商品发布、商品列表和登录后的状态处理。";
  const annotations = normalizeAnnotations(
    [
      {
        roundIndex: 1,
        quote: "负责商品发布 商品列表 和登录后的状态处理",
        type: "strength",
        dimensions: ["回答完整度"],
        comment: "这里说明了具体负责内容。",
        severity: "low",
      },
    ],
    [{ answer }]
  );

  assert.equal(annotations.length, 1);
  assert.equal(annotations[0].quote, "负责商品发布 商品列表 和登录后的状态处理");
  assert.equal(annotations[0].start, answer.indexOf("负责商品发布"));
});

test("fuzzily matches quote with minor ASR wording differences", () => {
  const answer = "我在交点科技实习期间，主要做用户分层和运营数据看板。";
  const match = findQuoteRange(answer, "我在焦点科技实习期间主要做用户分层和运营数据看板");

  assert.ok(match);
  assert.equal(match.start, answer.indexOf("我在交点科技"));
  assert.equal(match.end, answer.indexOf("数据看板") + "数据看板".length);
});

test("matches long quotes when spoken fillers interrupt the sentence", () => {
  const answer =
    "我之前呢，在一个校园项目里面主要负责运营，然后也做了一些数据分析，嗯，虽然不是特别深入，但我觉得自己还是比较适合这个岗位吧。";
  const match = findQuoteRange(
    answer,
    "我之前在一个校园项目里面主要负责运营，然后也做了一些数据分析，虽然不是特别深入，但我觉得自己还是比较适合这个岗位"
  );

  assert.ok(match);
  assert.equal(match.start, answer.indexOf("我之前"));
  assert.equal(match.end, answer.indexOf("这个岗位") + "这个岗位".length);
});

test("falls back to the longest useful partial quote", () => {
  const answer = "我的核心判断是这个岗位平台好，可以学到很多东西，所以想争取一下。";
  const match = findQuoteRange(answer, "我觉得自己应该能胜任吧，因为平台好，可以学到很多东西");

  assert.ok(match);
  assert.equal(match.start, answer.indexOf("平台好"));
  assert.equal(match.end, answer.indexOf("很多东西") + "很多东西".length);
});

test("keeps missing annotations and includes them in weakness summary", () => {
  const annotations = normalizeAnnotations(
    [
      {
        roundIndex: 1,
        quote: "",
        type: "missing",
        dimensions: ["回答完整度"],
        comment: "这轮回答缺少项目结果。",
        suggestion: "补充上线情况或反馈。",
        severity: "medium",
      },
    ],
    rounds
  );
  const summaries = summarizeAnnotations(annotations, rounds.length);

  assert.equal(annotations.length, 1);
  assert.equal(annotations[0].type, "missing");
  assert.deepEqual(summaries[0], {
    roundIndex: 1,
    strengths: 0,
    weaknesses: 1,
    suggestions: 0,
    mbtiEvidence: 0,
  });
});

test("limits each round to seven annotations", () => {
  const rawAnnotations = Array.from({ length: 8 }, (_, index) => ({
    roundIndex: 1,
    quote: index % 2 === 0 ? "校园二手交易平台项目" : "完成了发布流程",
    type: index % 2 === 0 ? "strength" : "suggestion",
    dimensions: ["回答完整度"],
    comment: `第 ${index + 1} 条标注`,
    severity: "low",
  }));

  const annotations = normalizeAnnotations(rawAnnotations, rounds);

  assert.ok(annotations.length <= 7);
});

test("keeps one holistic review per round", () => {
  const reviews = normalizeRoundReviews(
    [
      {
        roundIndex: 2,
        overallComment: "这一轮整体回答比较虚，缺少个人贡献和结果。",
        mainIssue: "没有真正证明自己做了什么。",
        nextStep: "先讲背景，再讲个人动作和结果。",
      },
      {
        roundIndex: 2,
        overallComment: "重复轮次应该被丢弃。",
      },
      {
        roundIndex: 1,
        overallComment: "这一轮基本答到了问题，但还可以更聚焦。",
        mainStrength: "能交代项目背景和职责。",
      },
    ],
    rounds.length
  );

  assert.deepEqual(
    reviews.map((item) => item.roundIndex),
    [1, 2]
  );
  assert.equal(reviews[0].mainStrength, "能交代项目背景和职责。");
  assert.equal(reviews[1].mainIssue, "没有真正证明自己做了什么。");
});
