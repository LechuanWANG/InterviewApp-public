export type ChatMessage = { role: "user" | "assistant"; content: string };

export interface LLMProvider {
  name: string;
  completeJSON<T = unknown>(params: {
    system: string;
    messages: ChatMessage[];
    thinkingEnabled?: boolean;
  }): Promise<T>;
}
