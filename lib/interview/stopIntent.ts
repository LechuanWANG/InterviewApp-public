import { getLLM } from "../llm";
import type { Session } from "../types";

export type CandidateStopIntent = {
  shouldEnd: boolean;
  confidence: number;
  reason: string;
};

export async function detectCandidateStopIntentWithLLM(params: {
  session: Session;
  answer: string;
}): Promise<CandidateStopIntent> {
  const answer = params.answer.trim();
  if (!answer) {
    return { shouldEnd: false, confidence: 1, reason: "empty answer is not an explicit stop request" };
  }

  const system = `你是模拟面试系统中的“候选人停止意图识别节点”。
你的任务只判断候选人最新回答是否明确要求结束/停止本场面试。

判定为 shouldEnd=true 的条件：
- 候选人明确说不想继续面试、想结束、停止、先到这里、不用继续、退出。
- 英文中明确说 stop/end/quit/wrap up 或 don't want to continue the interview。

必须判定为 shouldEnd=false 的情况：
- 只是说某个项目/方案/实习没有继续，不代表结束面试。
- 只是回答质量差、跑题、沉默、未作答，不代表结束面试。
- 只是表达焦虑、不会、不确定、没准备好，但没有明确要求结束。
- 只是说“不想继续用某个方案/方法/方向”，不代表结束面试。

只输出 JSON。`;

  const user = `【面试语言】${params.session.language}
【当前问题】${params.session.currentQuestion || ""}
【候选人最新回答】
${answer}

请输出：
{
  "shouldEnd": true | false,
  "confidence": 0 到 1 的数字,
  "reason": "一句话说明判断依据"
}`;

  try {
    const raw = await getLLM({
      provider: params.session.provider,
      model: params.session.model,
      thinkingEnabled: params.session.thinkingEnabled,
    }).completeJSON<Partial<CandidateStopIntent>>({
      system,
      messages: [{ role: "user", content: user }],
      thinkingEnabled: false,
    });

    const confidence = clampConfidence(raw.confidence);
    return {
      shouldEnd: raw.shouldEnd === true && confidence >= 0.75,
      confidence,
      reason: typeof raw.reason === "string" ? raw.reason : "",
    };
  } catch (error) {
    console.warn("candidate stop intent detection failed", error);
    return { shouldEnd: false, confidence: 0, reason: "intent detection failed" };
  }
}

function clampConfidence(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}
