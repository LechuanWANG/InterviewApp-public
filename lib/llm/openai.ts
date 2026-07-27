import OpenAI from "openai";
import "../proxy";
import type { LLMProvider, ChatMessage } from "./types";
import { extractChatCompletionContent } from "./chatCompletion";
import { parseJSONWithRepair } from "./json";

export function createOpenAIProvider(modelOverride?: string): LLMProvider {
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL || undefined,
  });
  const model = modelOverride || process.env.OPENAI_MODEL || "gpt-4o";

  return {
    name: "openai",
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
          { role: "system", content: system + "\n\nReturn only valid JSON." },
          ...messages.map((m) => ({ role: m.role, content: m.content })),
        ],
      });
      const text = extractChatCompletionContent(res, "OpenAI");
      return parseJSONWithRepair<T>(text, async (broken) => {
        const fixed = await client.chat.completions.create({
          model,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "You are a JSON repairer. Return only valid JSON. Do not include markdown or explanations.",
            },
            {
              role: "user",
              content:
                "Repair the following content into valid JSON while preserving the original meaning and fields:\n\n" +
                broken,
            },
          ],
        });
        return extractChatCompletionContent(fixed, "OpenAI");
      });
    },
  };
}
