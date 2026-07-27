import { getLLM } from "@/lib/llm";
import { findGroupPersona, turnTakingMembers } from "./groupPersonas";
import type { DirectorDecision, GroupInterviewSession, SpeechIntent } from "./types";
import {
  languageLabel,
  llmConfigOf,
  memberName,
  recentTranscriptForPrompt,
  rosterForPrompt,
  speakCounts,
  topicForPrompt,
} from "./prompts/shared";

export type DirectorContext = {
  remainingSec: number;
  totalSec: number;
  userRaisedHand: boolean;
  // 用户刚刚"让别人先说"(主动/超时跳过)：本回合不要再强制点用户，让 AI 接着说
  skipUserPrompt?: boolean;
};

const VALID_INTENTS: SpeechIntent[] = [
  "open",
  "build_on",
  "challenge",
  "summarize",
  "cue_quiet",
  "wrap_up",
  "statement",
];

/**
 * 决定下一个发言者与发言意图。
 * - statements 阶段：确定性按成员顺序轮流，全部完成则 wrapUp。
 * - discussion 阶段：LLM 调度(谁还没说、人格倾向、是否有人抢话、剩余时间)，带兜底与守卫。
 */
export async function decideNextSpeaker(
  session: GroupInterviewSession,
  ctx: DirectorContext
): Promise<DirectorDecision> {
  if (session.phase === "statements") {
    return decideStatementSpeaker(session);
  }
  return decideDiscussionSpeaker(session, ctx);
}

function lastSpeakerId(session: GroupInterviewSession): string | null {
  for (let i = session.transcript.length - 1; i >= 0; i -= 1) {
    const t = session.transcript[i];
    if (t.kind === "speech" || t.kind === "statement") return t.speakerId;
  }
  return null;
}

function decideStatementSpeaker(session: GroupInterviewSession): DirectorDecision {
  const givers = new Set(
    session.transcript.filter((t) => t.kind === "statement").map((t) => t.speakerId)
  );
  const next = turnTakingMembers(session.members).find((m) => !givers.has(m.id));
  if (!next) {
    return {
      nextSpeaker: "",
      intent: "open",
      referToSpeakers: [],
      reason: "所有人已完成个人陈述，进入自由讨论。",
      shouldPromptUser: false,
      wrapUp: true,
    };
  }
  return {
    nextSpeaker: next.id,
    intent: "statement",
    referToSpeakers: [],
    reason: "个人陈述按顺序进行。",
    shouldPromptUser: next.kind === "user",
    wrapUp: false,
  };
}

async function decideDiscussionSpeaker(
  session: GroupInterviewSession,
  ctx: DirectorContext
): Promise<DirectorDecision> {
  const members = turnTakingMembers(session.members);
  const last = lastSpeakerId(session);
  const userMember = members.find((m) => m.kind === "user");

  // 守卫 1：用户抢答 → 强制让位给用户
  if (ctx.userRaisedHand && userMember) {
    return {
      nextSpeaker: userMember.id,
      intent: "build_on",
      referToSpeakers: last ? [last] : [],
      reason: "用户举手抢答，交给用户发言。",
      shouldPromptUser: true,
      wrapUp: false,
    };
  }

  const lowTime = ctx.remainingSec <= Math.max(45, ctx.totalSec * 0.15);
  const firstDiscussionTurn = session.transcript.every((t) => t.kind !== "speech");
  if (firstDiscussionTurn) {
    const nextSpeaker = openingDiscussionSpeakerId(session, last);
    return {
      nextSpeaker,
      intent: "summarize",
      referToSpeakers: openingDiscussionReferences(session, nextSpeaker),
      reason: "自由讨论刚开始，先综合第一轮里印象较深的观点，而不是只承接最后一位。",
      shouldPromptUser: false,
      wrapUp: false,
    };
  }

  try {
    const decision = await llmDirect(session, ctx, { lowTime, last });
    return normalizeDecision(session, decision, { last, lowTime });
  } catch (error) {
    console.warn("director decision failed, using heuristic fallback", error);
    return heuristicDecision(session, { last, lowTime });
  }
}

async function llmDirect(
  session: GroupInterviewSession,
  ctx: DirectorContext,
  hints: { lowTime: boolean; last: string | null }
): Promise<DirectorDecision> {
  const counts = speakCounts(session);
  const countLines = turnTakingMembers(session.members)
    .map((m) => `- ${m.id}（${m.name}${m.kind === "user" ? "·用户" : ""}）：已发言 ${counts[m.id] ?? 0} 次`)
    .join("\n");

  const system = `你是一场校招无领导小组讨论的【隐形调度器】，负责决定下一个该谁发言、用什么意图发言，让讨论真实、流动、有抢答和承接的节奏。
原则：
- 让讨论像真实群面：有人承接、有人补充、有人反驳、有人总结，偶尔点名沉默的同学。
- 平衡发言机会：优先让发言较少的人，避免一两个人垄断。
- 用户(user)是真人参与者：自由讨论阶段不要主动选择 user；只有用户举手抢答时，系统才会把发言权交给 user。
- 时间快到时(lowTime)：倾向 summarize / wrap_up，推动收敛。
- nextSpeaker 必须是名册里的一个 AI 同学 id，不能是 user。
全程使用${languageLabel(session.language)}。严格只输出 JSON。`;

  const userContent = `${topicForPrompt(session)}

【成员名册】
${rosterForPrompt(session)}

【发言次数】
${countLines}

【最近发言】
${recentTranscriptForPrompt(session)}

【状态】
- 上一个发言者：${hints.last ? memberName(session, hints.last) : "无"}
- 剩余时间：${ctx.remainingSec}s / 共 ${ctx.totalSec}s
- 是否临近结束：${hints.lowTime ? "是" : "否"}

自由讨论刚开始时，请像真人一样先综合第一轮个人陈述中最有代表性或印象最深的 2-3 个观点；不要机械承接最后一位同学。

请输出 JSON：
{
  "nextSpeaker": "下一个发言者的 AI 同学 id(必须来自名册，不能为 user)",
  "intent": "open | build_on | challenge | summarize | cue_quiet | wrap_up",
  "referToSpeakers": ["该承接/回应的发言者 id，可空"],
  "reason": "一句话说明为什么这样安排",
  "shouldPromptUser": false
}`;

  return getLLM(llmConfigOf(session)).completeJSON<DirectorDecision>({
    system,
    messages: [{ role: "user", content: userContent }],
    thinkingEnabled: false,
  });
}

function normalizeDecision(
  session: GroupInterviewSession,
  raw: DirectorDecision | undefined,
  hints: { last: string | null; lowTime: boolean }
): DirectorDecision {
  const members = turnTakingMembers(session.members);
  const ids = new Set(members.map((m) => m.id));
  let nextSpeaker = typeof raw?.nextSpeaker === "string" && ids.has(raw.nextSpeaker)
    ? raw.nextSpeaker
    : leastSpokenStudentId(session, hints.last);

  const userId = members.find((m) => m.kind === "user")?.id;
  // 自由讨论不主动点用户；用户只通过举手抢答进入发言。
  if (nextSpeaker === userId) {
    nextSpeaker = leastSpokenStudentId(session, hints.last);
  }

  // 避免同一人连续两次发言
  if (nextSpeaker === hints.last) {
    nextSpeaker = leastSpokenStudentId(session, hints.last);
  }

  const intent: SpeechIntent = VALID_INTENTS.includes(raw?.intent as SpeechIntent)
    ? (raw!.intent as SpeechIntent)
    : hints.lowTime
      ? "summarize"
      : "build_on";

  return {
    nextSpeaker,
    intent: intent === "statement" ? "build_on" : intent,
    referToSpeakers: Array.isArray(raw?.referToSpeakers)
      ? raw!.referToSpeakers.filter((id) => ids.has(id) || id === "host")
      : hints.last
        ? [hints.last]
        : [],
    reason: typeof raw?.reason === "string" ? raw.reason.slice(0, 160) : "推进讨论。",
    shouldPromptUser: false,
    wrapUp: false,
  };
}

function heuristicDecision(
  session: GroupInterviewSession,
  hints: { last: string | null; lowTime: boolean }
): DirectorDecision {
  const nextSpeaker = leastSpokenStudentId(session, hints.last);
  return {
    nextSpeaker,
    intent: hints.lowTime ? "summarize" : "build_on",
    referToSpeakers: hints.last ? [hints.last] : [],
    reason: "按发言次数轮转。",
    shouldPromptUser: false,
    wrapUp: false,
  };
}

function openingDiscussionSpeakerId(session: GroupInterviewSession, last: string | null): string {
  const students = turnTakingMembers(session.members).filter((m) => m.kind === "student" && m.id !== last);
  return (
    students.find((m) => m.persona === "synthesizer")?.id ??
    students.find((m) => m.persona === "leader")?.id ??
    leastSpokenStudentId(session, last)
  );
}

function openingDiscussionReferences(session: GroupInterviewSession, nextSpeaker: string): string[] {
  const statements = session.transcript.filter(
    (t) => t.kind === "statement" && t.speakerId !== nextSpeaker
  );
  const bySpeaker = new Map<string, (typeof statements)[number]>();
  for (const turn of statements) {
    if (!bySpeaker.has(turn.speakerId)) bySpeaker.set(turn.speakerId, turn);
  }
  const unique = Array.from(bySpeaker.values());
  if (unique.length <= 3) return unique.map((t) => t.speakerId);

  return unique
    .slice()
    .sort((a, b) => b.text.length - a.text.length || a.index - b.index)
    .slice(0, 3)
    .map((t) => t.speakerId);
}

// 选发言最少的【学生】(默认不强制选用户，用户机会由守卫控制)，排除上一个发言者
function leastSpokenStudentId(session: GroupInterviewSession, last: string | null): string {
  const counts = speakCounts(session);
  const students = turnTakingMembers(session.members).filter(
    (m) => m.kind === "student" && m.id !== last
  );
  const pool = students.length ? students : turnTakingMembers(session.members).filter((m) => m.kind === "student");
  if (!pool.length) return turnTakingMembers(session.members)[0]?.id ?? "student_1";
  // 发言最少者优先；并列时按人格 speakWeight 偏置(越爱说越可能抢话)
  return pool
    .slice()
    .sort((a, b) => {
      const ca = counts[a.id] ?? 0;
      const cb = counts[b.id] ?? 0;
      if (ca !== cb) return ca - cb;
      return findGroupPersona(b.persona).speakWeight - findGroupPersona(a.persona).speakWeight;
    })[0].id;
}
