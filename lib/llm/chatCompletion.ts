type ChatCompletionChoice = {
  finish_reason?: string | null;
  message?: {
    content?: string | null;
  } | null;
};

type ChatCompletionResponse = {
  choices?: ChatCompletionChoice[] | null;
  error?: unknown;
};

export function extractChatCompletionContent(
  response: unknown,
  providerName: string
): string {
  if (!response || typeof response !== "object") {
    throw new Error(
      `${providerName} returned invalid response: ${formatUnknown(response)}`
    );
  }

  const completion = response as ChatCompletionResponse;
  const choice = Array.isArray(completion.choices)
    ? completion.choices[0]
    : undefined;
  const content = choice?.message?.content;
  if (typeof content === "string" && content.trim()) {
    return content;
  }

  const finishReason = choice?.finish_reason
    ? ` finish_reason=${choice.finish_reason}`
    : "";
  const providerError = formatProviderError(completion.error);
  const details = providerError ? ` ${providerError}` : "";
  throw new Error(
    `${providerName} returned empty content.${finishReason}${details}`
  );
}

function formatProviderError(error: unknown): string {
  if (!error) return "";
  if (typeof error === "string") return `error=${error.slice(0, 300)}`;
  if (typeof error !== "object") return `error=${String(error)}`;

  const record = error as Record<string, unknown>;
  const message = record.message;
  const type = record.type;
  const code = record.code;
  return [
    typeof message === "string" ? `message=${message}` : "",
    typeof type === "string" ? `type=${type}` : "",
    typeof code === "string" ? `code=${code}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function formatUnknown(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value.slice(0, 300);
  try {
    return JSON.stringify(value).slice(0, 300);
  } catch {
    return String(value).slice(0, 300);
  }
}
