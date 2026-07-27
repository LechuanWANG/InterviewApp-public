import Anthropic from "@anthropic-ai/sdk";
import "../proxy";
import type { LLMProvider, ChatMessage } from "./types";
import { parseJSONWithRepair } from "./json";

export function createAnthropicProvider(modelOverride?: string): LLMProvider {
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseURL: process.env.ANTHROPIC_BASE_URL || undefined,
  });
  const model = modelOverride || process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

  return {
    name: "anthropic",
    async completeJSON<T>({
      system,
      messages,
      thinkingEnabled: _thinkingEnabled,
    }: {
      system: string;
      messages: ChatMessage[];
      thinkingEnabled?: boolean;
    }): Promise<T> {
      const res = await client.messages.create({
        model,
        max_tokens: 4096,
        system: system + "\n\n严格只返回合法的 JSON，不要包含任何 markdown 代码块或解释文字。",
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      });
      const text = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      return parseJSONWithRepair<T>(text, async (broken) => {
        const fixed = await client.messages.create({
          model,
          max_tokens: 4096,
          system:
            "你是 JSON 修复器。请把用户给出的内容修复成合法 JSON。严格只返回合法 JSON，不要输出解释、不要输出 markdown 代码块。",
          messages: [
            {
              role: "user",
              content:
                "请修复下面这段 JSON，使其成为合法 JSON，保留原意与原字段，不要增删无关内容：\n\n" +
                broken,
            },
          ],
        });
        return fixed.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("");
      });
    },
  };
}
