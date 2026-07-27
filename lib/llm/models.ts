export type ModelOption = {
  id: string;
  label: string;
  provider: "deepseek" | "openai" | "anthropic" | "doubao";
  model: string;
  note?: string;
};

export const MODEL_OPTIONS: ModelOption[] = [
  {
    id: "deepseek-v4-pro",
    label: "DeepSeek V4 Pro",
    provider: "deepseek",
    model: "deepseek-v4-pro",
    note: "高质量对话&分析",
  },
  {
    id: "deepseek-v4-flash",
    label: "DeepSeek V4 Flash",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    note: "快速响应",
  },
];

export const DEFAULT_MODEL_ID = "deepseek-v4-pro";

export function findModel(id: string): ModelOption {
  return MODEL_OPTIONS.find((m) => m.id === id) ?? MODEL_OPTIONS[0];
}
