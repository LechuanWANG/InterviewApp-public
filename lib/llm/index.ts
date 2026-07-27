import type { LLMProvider } from "./types";
import { createAnthropicProvider } from "./anthropic";
import { createOpenAIProvider } from "./openai";
import { createDeepSeekProvider } from "./deepseek";
import { createDoubaoProvider } from "./doubao";

export type LLMOverride = { provider?: string; model?: string; thinkingEnabled?: boolean };

export function getLLM(override: LLMOverride = {}): LLMProvider {
  const provider = (override.provider || process.env.LLM_PROVIDER || "anthropic").toLowerCase();
  const model = override.model;
  if (provider === "openai") return createOpenAIProvider(model);
  if (provider === "deepseek") return createDeepSeekProvider(model);
  if (provider === "doubao") return createDoubaoProvider(model);
  return createAnthropicProvider(model);
}

export type { LLMProvider, ChatMessage } from "./types";
