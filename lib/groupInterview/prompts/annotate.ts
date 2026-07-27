import { getLLM } from "@/lib/llm";
import { findQuoteRange } from "@/lib/prompts/annotateAnswersCore";
import {
  GROUP_REPORT_DIMENSIONS,
  type GroupDimension,
  type GroupInterviewSession,
  type GroupTurn,
  type GroupTurnAnnotation,
  type GroupTurnAnnotationSeverity,
  type GroupTurnAnnotationType,
  type GroupTurnReview,
} from "../types";
import { compactText, languageLabel, llmConfigOf, memberName, topicForPrompt } from "./shared";

export type GroupTurnAnnotationResult = {
  turnReviews: GroupTurnReview[]; // 0 或 1 条(本条发言)
  turnAnnotations: GroupTurnAnnotation[];
};

const ANNOTATION_TYPES: GroupTurnAnnotationType[] = [
  "strength",
  "weakness",
  "suggestion",
  "clarity",
  "missing",
];
const SEVERITIES: GroupTurnAnnotationSeverity[] = ["low", "medium", "high"];
const MAX_ANNOTATIONS_PER_TURN = 6;

type RawTurnAnnotation = {
  review?: {
    overallComment?: unknown;
    mainStrength?: unknown;
    mainIssue?: unknown;
    nextStep?: unknown;
  };
  annotations?: unknown;
};

/** 用户在本场的全部有效发言(逐条批注的对象)。 */
export function userTurns(session: GroupInterviewSession): GroupTurn[] {
  return session.transcript.filter((t) => t.speakerId === "user" && t.text.trim().length > 0);
}

/**
 * 逐条批改：每次只点评【用户本人的一条发言】，单独调用一次 LLM。
 * 这样群面报告页可以「每完成一条就立即呈现一条」，而不是等全部发言一起返回。
 */
export async function annotateGroupTurn(
  session: GroupInterviewSession,
  turnIndex: number
): Promise<GroupTurnAnnotationResult> {
  const turn = session.transcript.find((t) => t.index === turnIndex);
  if (!turn || turn.speakerId !== "user" || !turn.text.trim()) {
    return { turnReviews: [], turnAnnotations: [] };
  }

  const lang = languageLabel(session.language);
  const dimensionList = GROUP_REPORT_DIMENSIONS.join("、");
  const kindLabel =
    turn.kind === "statement" ? "个人陈述" : turn.kind === "report" ? "代表汇报" : "自由讨论发言";

  const system = `你是资深校招群面(无领导小组讨论)评委，正在逐条批改【用户本人】的发言。请严格以 ${lang} 输出。
你只点评用户这一条发言，帮助用户理解：是否贡献了有效观点、是否推动/承接了讨论、表达是否清晰、有没有团队协作意识。

规则：
- 只输出 JSON，不要输出 markdown
- 先给整体点评(review)，再给少量局部标注(annotations)
- quote 必须逐字复制用户这条发言中的原文片段，不能改写
- type 只能是 strength、weakness、suggestion、clarity、missing
- dimensions 只能从这几个维度选择：${dimensionList}
- missing 表示该说而没说的内容，quote 可为空字符串；其它类型必须给 quote
- 本条最多 ${MAX_ANNOTATIONS_PER_TURN} 条标注，少而准
- 对语音识别的轻微错别字、口头词(嗯/啊/然后/就是/那个)要宽容，不要据此判 weakness
- strength 只给真正有说服力的亮点(提出框架、推动共识、有效承接他人、给出关键数据/结论)，不要因为“说得还行”就给
- 群面看重协作：抢话压人、忽视他人、跑题、只附和不贡献都应明确指出
- 所有 comment、suggestion、quote 都必须是合法 JSON 字符串`;

  const userContent = `${topicForPrompt(session)}

【讨论上下文(节选，仅供理解，不要点评这些)】
${contextBefore(session, turn)}

【用户这条发言】(${kindLabel})
${turn.text}

请只点评用户这一条发言，输出 JSON：
{
  "review": {
    "overallComment": "${session.language === "en" ? "overall judgement of this contribution: did it add value, move the discussion, and read clearly" : "对这条发言的总体判断：是否有效贡献、是否推动讨论、表达是否清楚"}",
    "mainStrength": "${session.language === "en" ? "main strength of this contribution; leave empty if none" : "这条发言的主要亮点；没有可留空"}",
    "mainIssue": "${session.language === "en" ? "core issue of this contribution; leave empty if none" : "这条发言最核心的问题；没有可留空"}",
    "nextStep": "${session.language === "en" ? "highest-priority improvement next time" : "下次类似场景最该改进的一点"}"
  },
  "annotations": [
    {
      "quote": "${session.language === "en" ? "exact text copied from this contribution; missing type may be empty" : "逐字摘自这条发言的原文片段；missing 类型可为空"}",
      "type": "strength | weakness | suggestion | clarity | missing",
      "dimensions": ["${GROUP_REPORT_DIMENSIONS.join(" | ")}"],
      "comment": "${session.language === "en" ? "short comment" : "简短评语"}",
      "suggestion": "${session.language === "en" ? "specific suggestion" : "具体改进建议"}",
      "severity": "low | medium | high"
    }
  ]
}`;

  const raw = await getLLM(llmConfigOf(session)).completeJSON<RawTurnAnnotation>({
    system,
    messages: [{ role: "user", content: userContent }],
    thinkingEnabled: session.thinkingEnabled,
  });

  return {
    turnReviews: normalizeReview(raw?.review, turnIndex),
    turnAnnotations: normalizeTurnAnnotations(raw?.annotations, turn.text, turnIndex),
  };
}

function contextBefore(session: GroupInterviewSession, turn: GroupTurn): string {
  const position = session.transcript.findIndex((t) => t.index === turn.index);
  const preceding = position > 0 ? session.transcript.slice(Math.max(0, position - 4), position) : [];
  if (!preceding.length) return "（这是较早的发言，无更多上文）";
  return preceding
    .map((t) => {
      const isUser = t.speakerId === "user";
      const name = isUser ? `${memberName(session, t.speakerId)}(用户)` : memberName(session, t.speakerId);
      return `[${t.index}] ${name}：${compactText(t.text, 160)}`;
    })
    .join("\n");
}

function normalizeReview(raw: RawTurnAnnotation["review"], turnIndex: number): GroupTurnReview[] {
  if (!raw || typeof raw !== "object") return [];
  const overallComment = asString(raw.overallComment);
  if (!overallComment) return [];
  return [
    {
      turnIndex,
      overallComment,
      mainStrength: asString(raw.mainStrength) ?? undefined,
      mainIssue: asString(raw.mainIssue) ?? undefined,
      nextStep: asString(raw.nextStep) ?? undefined,
    },
  ];
}

function normalizeTurnAnnotations(
  value: unknown,
  text: string,
  turnIndex: number
): GroupTurnAnnotation[] {
  if (!Array.isArray(value)) return [];

  const accepted: GroupTurnAnnotation[] = [];
  const occupied: Array<{ start: number; end: number }> = [];

  for (const item of value) {
    if (accepted.length >= MAX_ANNOTATIONS_PER_TURN) break;
    const raw = item && typeof item === "object" ? (item as Record<string, unknown>) : {};

    const type = ANNOTATION_TYPES.includes(raw.type as GroupTurnAnnotationType)
      ? (raw.type as GroupTurnAnnotationType)
      : null;
    if (!type) continue;

    const comment = asString(raw.comment);
    if (!comment) continue;

    const quote = asString(raw.quote) ?? "";
    const dimensions = Array.isArray(raw.dimensions)
      ? (Array.from(
          new Set(
            raw.dimensions.filter((d): d is GroupDimension =>
              GROUP_REPORT_DIMENSIONS.includes(d as GroupDimension)
            )
          )
        ) as GroupDimension[])
      : [];
    const severity = SEVERITIES.includes(raw.severity as GroupTurnAnnotationSeverity)
      ? (raw.severity as GroupTurnAnnotationSeverity)
      : "medium";
    const suggestion = asString(raw.suggestion) ?? undefined;

    let start = 0;
    let end = 0;
    if (type !== "missing") {
      if (!quote) continue;
      const match = findQuoteRange(text, quote);
      if (!match) continue;
      start = match.start;
      end = match.end;
      if (occupied.some((range) => start < range.end && end > range.start)) continue;
      occupied.push({ start, end });
    }

    accepted.push({
      id: `t${turnIndex}-a${accepted.length + 1}`,
      turnIndex,
      start,
      end,
      quote,
      type,
      dimensions,
      comment,
      suggestion,
      severity,
    });
  }

  return accepted.sort((a, b) => a.start - b.start);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
