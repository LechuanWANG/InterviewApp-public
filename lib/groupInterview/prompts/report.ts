import { getLLM } from "@/lib/llm";
import type { ReportDimensionDetail } from "@/lib/types";
import {
  type GroupDimension,
  type GroupInterviewSession,
  type GroupReport,
  GROUP_REPORT_DIMENSIONS,
} from "../types";
import { languageLabel, llmConfigOf, memberName, topicForPrompt } from "./shared";

/**
 * 结束后生成「个人 + 群体」双视角报告(含面试官视角点评，无实时面试官问答)。
 * 个人视角聚焦用户(speakerId === "user")的表现。
 */
export async function generateGroupReport(session: GroupInterviewSession): Promise<GroupReport> {
  const transcript = formatFullTranscript(session);
  const userMember = session.members.find((m) => m.kind === "user");
  const reporterName = session.reporterId ? memberName(session, session.reporterId) : "（未指定）";
  const reporterIsUser = session.reporterKind === "user";

  const system = `你是资深校招群面(无领导小组讨论)评委。下面给你一场群面的完整记录。
请站在三个视角输出结构化评价：
1) 个人视角：聚焦【用户本人】(记录中标注为"你/用户")的表现，给出 6 个维度评分(0-9，只能是 0.5 的倍数)、证据、原因、改进建议，并打一个本场角色标签(如：领导者/总结者/积极贡献者/边缘者)。
2) 群体视角：整组讨论质量、共识、分歧、协作评分、汇报质量点评。
3) 面试官视角：站在听汇报的面试官角度，对汇报与全组讨论给一段点评(此环节无实时问答，仅书面呈现)。

评分维度(personal.dimensions 的 key 必须用这 6 个)：${GROUP_REPORT_DIMENSIONS.join("、")}。
所有分数都必须是 0、0.5、1、1.5……9 这样的 0.5 档位，不能输出 6.2、7.3 等更细小数。
评价必须基于记录中的真实发言证据，不要凭空编造用户没说过的内容。
全程使用${languageLabel(session.language)}。严格只输出 JSON。`;

  const userContent = `${topicForPrompt(session)}

【用户在本场的身份】${userMember?.name ?? "你"}（记录中标注为该名字）
【汇报人】${reporterName}${reporterIsUser ? "（就是用户本人）" : ""}

【完整发言记录】
${transcript}

请输出 JSON：
{
  "personal": {
    "overallScore": 0-9 且只能是 0.5 的倍数,
    "roleTag": "本场角色标签",
    "dimensions": {
      ${GROUP_REPORT_DIMENSIONS.map((d) => `"${d}": { "score": 0-9 且只能是 0.5 的倍数, "evidence": ["原文证据片段"], "reason": "评分原因", "advice": "改进建议" }`).join(",\n      ")}
    },
    "strengths": ["亮点1", "亮点2"],
    "weaknesses": ["问题1", "问题2"],
    "advice": ["下次怎么抢/怎么补/怎么收的可执行建议"],
    "keyMoments": [{ "turnIndex": 数字, "comment": "这个时刻你抓住/错过了什么" }]
  },
  "group": {
    "summary": "整组讨论一句话总结",
    "consensus": ["共识1", "共识2"],
    "disagreements": ["分歧1"],
    "collaborationScore": 0-9 且只能是 0.5 的倍数,
    "reportQuality": "对最终汇报质量的点评"
  },
  "leaderFeedback": "站在面试官角度的一段总评"
}`;

  try {
    const raw = await getLLM(llmConfigOf(session)).completeJSON<GroupReport>({
      system,
      messages: [{ role: "user", content: userContent }],
      thinkingEnabled: session.thinkingEnabled,
    });
    return normalizeReport(raw, session);
  } catch (error) {
    console.warn("group report generation failed, using fallback", error);
    return fallbackReport(session);
  }
}

// 限制条数与单条长度，避免长会话把报告 JSON 输出挤爆(token 预算)。
const MAX_REPORT_TRANSCRIPT_TURNS = 60;
const MAX_REPORT_TURN_CHARS = 400;

function compact(value: string, max: number): string {
  const normalized = (value || "").replace(/\s+/g, " ").trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`;
}

function formatFullTranscript(session: GroupInterviewSession): string {
  if (!session.transcript.length) return "（无发言记录）";
  const turns = session.transcript.slice(-MAX_REPORT_TRANSCRIPT_TURNS);
  const omitted = session.transcript.length - turns.length;
  const lines = turns.map((t) => {
    const isUser = t.speakerId === "user";
    const name = isUser ? `${t.speakerName}(用户)` : t.speakerName;
    const kindLabel =
      t.kind === "host" ? "HR" : t.kind === "statement" ? "陈述" : t.kind === "report" ? "汇报" : "讨论";
    return `[${t.index}] ${name} · ${kindLabel}：${compact(t.text, MAX_REPORT_TURN_CHARS)}`;
  });
  return (omitted > 0 ? `（已省略前 ${omitted} 条发言）\n` : "") + lines.join("\n");
}

function clampScore(value: unknown, fallback = 5.5): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  const normalized = n > 9 ? (n / 100) * 9 : n;
  return Math.round(Math.max(0, Math.min(9, normalized)) * 2) / 2;
}

function normalizeStringArray(value: unknown, max = 6): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v).trim()).filter(Boolean).slice(0, max);
}

function normalizeReport(raw: GroupReport | undefined, session: GroupInterviewSession): GroupReport {
  const dimensions: Partial<Record<GroupDimension, ReportDimensionDetail>> = {};
  for (const dim of GROUP_REPORT_DIMENSIONS) {
    const d = raw?.personal?.dimensions?.[dim];
    if (d) {
      dimensions[dim] = {
        score: clampScore(d.score),
        evidence: normalizeStringArray(d.evidence, 4),
        reason: typeof d.reason === "string" ? d.reason.trim() : "",
        advice: typeof d.advice === "string" ? d.advice.trim() : "",
      };
    }
  }

  return {
    personal: {
      overallScore: clampScore(raw?.personal?.overallScore),
      roleTag: typeof raw?.personal?.roleTag === "string" ? raw.personal.roleTag.trim() : "积极贡献者",
      dimensions,
      strengths: normalizeStringArray(raw?.personal?.strengths),
      weaknesses: normalizeStringArray(raw?.personal?.weaknesses),
      advice: normalizeStringArray(raw?.personal?.advice),
      keyMoments: Array.isArray(raw?.personal?.keyMoments)
        ? raw!.personal.keyMoments
            .map((m) => {
              const n = Number(m?.turnIndex);
              return {
                turnIndex: Number.isFinite(n) ? Math.trunc(n) : 0,
                comment: typeof m?.comment === "string" ? m.comment.trim() : "",
              };
            })
            .filter((m) => m.comment)
            .slice(0, 6)
        : [],
    },
    group: {
      summary: typeof raw?.group?.summary === "string" ? raw.group.summary.trim() : "",
      consensus: normalizeStringArray(raw?.group?.consensus),
      disagreements: normalizeStringArray(raw?.group?.disagreements),
      collaborationScore: clampScore(raw?.group?.collaborationScore),
      reportQuality: typeof raw?.group?.reportQuality === "string" ? raw.group.reportQuality.trim() : "",
    },
    leaderFeedback: typeof raw?.leaderFeedback === "string" ? raw.leaderFeedback.trim() : "",
  };
}

function fallbackReport(session: GroupInterviewSession): GroupReport {
  const zh = session.language === "zh";
  return {
    personal: {
      overallScore: 5.5,
      roleTag: zh ? "积极贡献者" : "Active contributor",
      dimensions: {},
      strengths: [],
      weaknesses: [],
      advice: [
        zh
          ? "报告生成失败，请稍后在历史记录中重试生成报告。"
          : "Report generation failed. Please retry from history later.",
      ],
      keyMoments: [],
    },
    group: {
      summary: zh ? "本场讨论记录已保存，报告稍后可重试生成。" : "Transcript saved; report can be regenerated later.",
      consensus: [],
      disagreements: [],
      collaborationScore: 5.5,
      reportQuality: "",
    },
    leaderFeedback: "",
  };
}
