import type { LLMProvider, ChatMessage } from "./types";
import { extractChatCompletionContent } from "./chatCompletion";
import { parseJSONWithRepair } from "./json";

type DeepSeekMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type DeepSeekCompletion = {
  choices?: Array<{
    finish_reason?: string | null;
    message?: {
      content?: string | null;
    };
  }>;
};

const DEEPSEEK_CHAT_COMPLETIONS_URL = "https://api.deepseek.com/chat/completions";

export function createDeepSeekProvider(modelOverride?: string): LLMProvider {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("需要在 .env.local 或 Cloudflare 环境变量中配置 DEEPSEEK_API_KEY");
  }
  const model = modelOverride || process.env.DEEPSEEK_MODEL || "deepseek-reasoner";

  return {
    name: "deepseek",
    async completeJSON<T>({
      system,
      messages,
      thinkingEnabled = false,
    }: {
      system: string;
      messages: ChatMessage[];
      thinkingEnabled?: boolean;
    }): Promise<T> {
      const text = await createDeepSeekChatCompletion({
        apiKey,
        model,
        maxTokens: 8000,
        thinkingEnabled,
        messages: [
          {
            role: "system",
            content:
              system +
              "\n\n严格只返回合法的 JSON 对象，不要包含 markdown 代码块、不要包含解释性文字。",
          },
          ...messages.map((m) => ({ role: m.role, content: m.content })),
        ],
      });
      return parseJSONWithRepair<T>(text, async (broken) => {
        return createDeepSeekChatCompletion({
          apiKey,
          model,
          maxTokens: 4000,
          thinkingEnabled: false,
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
      });
    },
  };
}

async function createDeepSeekChatCompletion(params: {
  apiKey: string;
  model: string;
  messages: DeepSeekMessage[];
  maxTokens: number;
  thinkingEnabled: boolean;
}): Promise<string> {
  const body: Record<string, unknown> = {
    model: params.model,
    max_tokens: params.maxTokens,
    response_format: { type: "json_object" },
    messages: params.messages,
  };

  if (supportsThinkingMode(params.model)) {
    body.thinking = {
      type: params.thinkingEnabled ? "enabled" : "disabled",
    };
  }

  let res: Response;
  try {
    res = await fetch(DEEPSEEK_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new Error(
      `DeepSeek request failed: ${
        error instanceof Error ? error.message : "network error"
      }`
    );
  }

  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `DeepSeek request failed (${res.status}): ${text.slice(0, 500)}`
    );
  }

  let data: DeepSeekCompletion | null;
  try {
    data = JSON.parse(text) as DeepSeekCompletion;
  } catch {
    throw new Error(`DeepSeek returned invalid response: ${text.slice(0, 500)}`);
  }

  return extractChatCompletionContent(data, "DeepSeek");
}

function supportsThinkingMode(model: string): boolean {
  return model === "deepseek-v4-pro" || model === "deepseek-v4-flash";
}
