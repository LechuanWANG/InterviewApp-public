import type { Round } from "../types";

export type CoverageAnswerQuality =
  | "good"
  | "shallow"
  | "off_topic"
  | "risky"
  | "empty"
  | "non_cooperative";

export type AnswerIntegrityIssue =
  | "valid"
  | "empty"
  | "low_signal"
  | "refusal"
  | "disruptive";

export type AnswerIntegritySeverity = "none" | "weak" | "invalid" | "terminate";

export type AnswerIntegrity = {
  issue: AnswerIntegrityIssue;
  severity: AnswerIntegritySeverity;
  reason: string;
};

export type AnswerIntegritySummary = {
  latest: AnswerIntegrity;
  invalidAnswerStreak: number;
  lowSignalStreak: number;
  terminatingIssueCount: number;
};

export type InterviewEndIntegrityDecision = {
  shouldEnd: boolean;
  reason: string;
};

const VALID_INTEGRITY: AnswerIntegrity = {
  issue: "valid",
  severity: "none",
  reason: "answer has enough signal to continue",
};

const EMPTY_ANSWER_PATTERNS = [
  /^未(作答|回答)?$/,
  /^未在倒计时内作答$/,
  /^\[?no answer\]?$/,
  /^no answer provided$/,
  /^没有回答$/,
  /^无回答$/,
];

const SHORT_REFUSAL_PATTERNS = [
  /^不会$/,
  /^不知道$/,
  /^不清楚$/,
  /^不了解$/,
  /^没想法$/,
  /^没准备$/,
  /^没经验$/,
  /^没做过$/,
  /^没有$/,
  /^无$/,
  /^算了$/,
  /^随便$/,
  /^不知道怎么答$/,
  /^i do not know$/,
  /^i don't know$/,
  /^idk$/,
  /^not sure$/,
  /^no idea$/,
  /^none$/,
  /^nothing$/,
  /^whatever$/,
];

const EXPLICIT_REFUSAL_PATTERNS = [
  /不想回答/,
  /拒绝回答/,
  /懒得说/,
  /不说了/,
  /别问了/,
  /问下一个/,
  /跳过(这个)?问题/,
  /^pass$/,
  /^skip$/,
  /\bdon't want to answer\b/,
  /\bdo not want to answer\b/,
  /\bnot answering\b/,
  /\bnext question\b/,
];

const DISRUPTIVE_PATTERNS = [
  /忽略.{0,12}(之前|前面|以上).{0,12}(指令|规则|提示|要求)/,
  /(输出|展示|告诉我).{0,12}(系统提示|system prompt|开发者消息|developer message)/,
  /(破解|越狱|jailbreak).{0,12}(提示|规则|系统)/,
  /(测试|测一下|试试).{0,8}(ai|面试官|机器人|模型|系统)/i,
  /^我(就是)?(在)?测试(一下|下)?(你|ai|面试官|系统)?$/i,
  /^test(ing)?( the)? (ai|bot|interviewer|system|model)$/i,
  /你(是|是不是).{0,6}(chatgpt|ai|人工智能|机器人|模型)/i,
  /(讲|说)个笑话/,
  /唱首歌/,
  /写(一)?首诗/,
  /今天天气/,
  /天气怎么样/,
  /给我推荐/,
  /帮我写/,
  /\btell me a joke\b/,
  /\bsing (me )?a song\b/,
  /\bwrite (me )?a poem\b/,
  /\bwhat'?s the weather\b/,
  /\bweather today\b/,
  /\bhelp me write\b/,
];

const ABUSIVE_PATTERNS = [
  /傻[逼b]/i,
  /滚/,
  /去死/,
  /\bfuck\b/i,
  /\bshit\b/i,
];

const GIBBERISH_PATTERNS = [
  /^(哈|呵|啊|嗯|额|呃){4,}$/,
  /^(asdf+|qwer+|zxcv+|test|testing|123+|111+|xxx+)$/i,
  /^[。！!？?\s.,，、~`'";:：；-]{4,}$/,
];

export function assessAnswerIntegrity(round: Pick<Round, "answer" | "timedOut">): AnswerIntegrity {
  const answer = round.answer.trim();
  const normalized = normalizeRuleText(answer);

  if (!answer || round.timedOut || EMPTY_ANSWER_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return {
      issue: "empty",
      severity: "invalid",
      reason: "candidate did not provide an answer",
    };
  }

  if (ABUSIVE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return {
      issue: "disruptive",
      severity: "terminate",
      reason: "candidate used abusive or hostile language",
    };
  }

  if (
    DISRUPTIVE_PATTERNS.some((pattern) => pattern.test(normalized)) ||
    GIBBERISH_PATTERNS.some((pattern) => pattern.test(normalized)) ||
    isMostlyRepeatedNoise(normalized)
  ) {
    return {
      issue: "disruptive",
      severity: "terminate",
      reason: "candidate response is unrelated, adversarial, or appears to be testing the interviewer",
    };
  }

  if (SHORT_REFUSAL_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return {
      issue: "refusal",
      severity: "invalid",
      reason: "candidate gave a direct refusal or no-knowledge answer",
    };
  }

  if (EXPLICIT_REFUSAL_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return {
      issue: "refusal",
      severity: "invalid",
      reason: "candidate refused to answer the current question",
    };
  }

  if (isLowSignalAnswer(answer, normalized)) {
    return {
      issue: "low_signal",
      severity: "weak",
      reason: "candidate answer has too little interview signal",
    };
  }

  return VALID_INTEGRITY;
}

export function summarizeAnswerIntegrity(rounds: Pick<Round, "answer" | "timedOut">[]): AnswerIntegritySummary {
  if (!rounds.length) {
    return {
      latest: VALID_INTEGRITY,
      invalidAnswerStreak: 0,
      lowSignalStreak: 0,
      terminatingIssueCount: 0,
    };
  }

  const assessments = rounds.map(assessAnswerIntegrity);
  let invalidAnswerStreak = 0;
  let lowSignalStreak = 0;

  for (let index = assessments.length - 1; index >= 0; index -= 1) {
    const severity = assessments[index].severity;
    if (severity === "invalid" || severity === "terminate") {
      invalidAnswerStreak += 1;
    } else {
      break;
    }
  }

  for (let index = assessments.length - 1; index >= 0; index -= 1) {
    const severity = assessments[index].severity;
    if (severity === "weak" || severity === "invalid" || severity === "terminate") {
      lowSignalStreak += 1;
    } else {
      break;
    }
  }

  return {
    latest: assessments[assessments.length - 1],
    invalidAnswerStreak,
    lowSignalStreak,
    terminatingIssueCount: assessments.filter((item) => item.severity === "terminate").length,
  };
}

export function shouldEndInterviewForAnswerIntegrity(params: {
  summary: AnswerIntegritySummary;
  coverageAnswerQuality?: CoverageAnswerQuality;
  consecutiveFollowUps: number;
}): InterviewEndIntegrityDecision {
  const { summary, coverageAnswerQuality } = params;

  // Philosophy: only content that is *completely unrelated to interviewing* ends the session on
  // quality grounds — abuse, prompt injection, testing the AI, jokes / chit-chat, or an explicit
  // refusal to participate. Not directly answering question A but engaging in a related direction
  // B, being shallow, or briefly drifting off-topic is NOT a reason to stop: the interviewer
  // should keep the conversation going and steer naturally.
  if (summary.latest.severity === "terminate") {
    return {
      shouldEnd: true,
      reason: summary.latest.reason,
    };
  }

  if (coverageAnswerQuality === "non_cooperative") {
    return {
      shouldEnd: true,
      reason: "latest answer was completely unrelated to the interview",
    };
  }

  // Safety net only: the candidate is not engaging at all (several consecutive empty / outright
  // refusal answers). Threshold kept lenient so off-topic-but-engaged candidates keep going.
  if (summary.invalidAnswerStreak >= 3) {
    return {
      shouldEnd: true,
      reason: "candidate gave several consecutive empty or refusal answers",
    };
  }

  return {
    shouldEnd: false,
    reason: "",
  };
}

function normalizeRuleText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'");
}

function isLowSignalAnswer(answer: string, normalized: string): boolean {
  const compact = normalized.replace(/[^\u4e00-\u9fffa-z0-9]/gi, "");
  if (compact.length <= 3) return true;

  const chineseChars = answer.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
  const latinWords = answer.match(/[a-z]{2,}/gi)?.length ?? 0;
  if (chineseChars === 0 && latinWords > 0 && latinWords <= 2) return true;
  if (chineseChars > 0 && chineseChars <= 5 && latinWords === 0) return true;

  const withoutFillers = normalized
    .replace(/(嗯|啊|额|呃|就是|然后|这个|那个|反正|还行|差不多|还可以|可能|大概|吧)/g, "")
    .replace(/\b(like|um|uh|basically|maybe|probably|whatever)\b/g, "")
    .replace(/[^\u4e00-\u9fffa-z0-9]/gi, "");

  return withoutFillers.length <= 5;
}

function isMostlyRepeatedNoise(normalized: string): boolean {
  const compact = normalized.replace(/[^\u4e00-\u9fffa-z0-9]/gi, "");
  if (compact.length < 5) return false;
  const chars = Array.from(compact);
  const unique = new Set(chars);
  if (unique.size <= 2 && compact.length >= 6) return true;
  return /(.)\1{5,}/.test(compact);
}
