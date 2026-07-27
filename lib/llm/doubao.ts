import OpenAI from "openai";
import "../proxy";
import type { LLMProvider, ChatMessage } from "./types";
import { extractChatCompletionContent } from "./chatCompletion";
import { parseJSONWithRepair } from "./json";

export function createDoubaoProvider(modelOverride?: string): LLMProvider {
  const apiKey = process.env.DOUBAO_LLM_API_KEY || process.env.ARK_API_KEY;
  if (!apiKey) {
    throw new Error("需要在 .env.local 配置 DOUBAO_LLM_API_KEY 或 ARK_API_KEY");
  }

  const client = new OpenAI({
    apiKey,
    baseURL:
      process.env.DOUBAO_LLM_BASE_URL ||
      process.env.ARK_BASE_URL ||
      "https://ark.cn-beijing.volces.com/api/v3",
  });
  const model =
    modelOverride ||
    process.env.DOUBAO_LLM_MODEL ||
    process.env.ARK_MODEL ||
    "doubao-1-5-pro-32k-250115";

  return {
    name: "doubao",
    async completeJSON<T>({
      system,
      messages,
      thinkingEnabled: _thinkingEnabled,
    }: {
      system: string;
      messages: ChatMessage[];
      thinkingEnabled?: boolean;
    }): Promise<T> {
      const res = await client.chat.completions.create({
        model,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              system +
              "\n\n严格只返回合法 JSON，不要包含 markdown 代码块或解释说明。",
          },
          ...messages.map((m) => ({ role: m.role, content: m.content })),
        ],
      });
      const text = extractChatCompletionContent(res, "Doubao");
      return parseJSONWithRepair<T>(text, async (broken) => {
        const fixed = await client.chat.completions.create({
          model,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "你是 JSON 修复器。严格只返回合法 JSON，不要包含 markdown 代码块，不要解释。",
            },
            {
              role: "user",
              content:
                "请修复下面这段 JSON，使其成为合法 JSON，保留原意与原字段，不要增删无关内容：\n\n" +
                broken,
            },
          ],
        });
        return extractChatCompletionContent(fixed, "Doubao");
      });
    },
  };
}
