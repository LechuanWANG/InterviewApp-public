import { getLLM } from "@/lib/llm";
import { findGroupPersona } from "../groupPersonas";
import type { GroupInterviewSession, GroupMember } from "../types";
import { languageLabel, llmConfigOf, recentTranscriptForPrompt, topicForPrompt } from "./shared";

/**
 * AI 同学代表小组做总结式汇报(仅当用户选择由 AI 汇报时)。
 * 返回一段面向面试官的结构化汇报文本。
 */
export async function generateAiReport(
  session: GroupInterviewSession,
  reporter: GroupMember
): Promise<string> {
  const persona = findGroupPersona(reporter.persona);
  const system = `你是校招群面中的学生 ${reporter.name}，被小组推选为代表，现在要面向面试官做总结式汇报。
${persona.styleHint}
汇报要求：
- 结构清晰：背景与目标 → 小组共识结论 → 关键分歧与取舍 → 最终建议。
- 体现这是【小组】的集体结论，适当提及组员的贡献，不要只讲自己。
- 控制在 4-7 句，语言正式、面向面试官，自信但不浮夸。
全程使用${languageLabel(session.language)}。严格只输出 JSON。`;

  const userContent = `${topicForPrompt(session)}

【讨论记录(节选)】
${recentTranscriptForPrompt(session, 20)}

请输出 JSON：
{ "report": "你面向面试官的汇报正文(4-7句)" }`;

  try {
    const raw = await getLLM(llmConfigOf(session)).completeJSON<{ report: string }>({
      system,
      messages: [{ role: "user", content: userContent }],
      thinkingEnabled: session.thinkingEnabled,
    });
    const text = typeof raw?.report === "string" ? raw.report.trim() : "";
    return text || fallbackReport(session, reporter);
  } catch (error) {
    console.warn("AI reporter generation failed, using fallback", error);
    return fallbackReport(session, reporter);
  }
}

function fallbackReport(session: GroupInterviewSession, reporter: GroupMember): string {
  if (session.language === "en") {
    return `On behalf of the group, here's our summary: we aligned on the main goal and constraints, agreed to prioritize the highest-impact, lowest-cost actions first, and discussed the trade-offs in sequencing. Our recommendation is to start with the core initiative and iterate. Thank you.`;
  }
  return `我代表小组汇报一下我们的讨论结论：我们首先对齐了目标和约束，达成的共识是优先做投入产出比最高、最容易落地的举措，分歧主要集中在推进顺序上。综合大家的意见，我们的建议是先从核心举措切入、再逐步迭代。汇报完毕，谢谢面试官。`;
}
