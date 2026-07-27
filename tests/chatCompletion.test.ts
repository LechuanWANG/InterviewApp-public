import assert from "node:assert/strict";
import test from "node:test";
import { extractChatCompletionContent } from "../lib/llm/chatCompletion";

test("extracts chat completion content", () => {
  const content = extractChatCompletionContent(
    {
      choices: [
        {
          message: {
            content: '{"ok":true}',
          },
        },
      ],
    },
    "DeepSeek"
  );

  assert.equal(content, '{"ok":true}');
});

test("rejects null chat completion response with provider context", () => {
  assert.throws(
    () => extractChatCompletionContent(null, "DeepSeek"),
    /DeepSeek returned invalid response: null/
  );
});

test("rejects missing choices without throwing a raw TypeError", () => {
  assert.throws(
    () => extractChatCompletionContent({ choices: null }, "Doubao"),
    /Doubao returned empty content\./
  );
});

test("includes provider error details when choices are absent", () => {
  assert.throws(
    () =>
      extractChatCompletionContent(
        {
          error: {
            message: "quota exceeded",
            type: "rate_limit",
            code: "rate_limit_exceeded",
          },
        },
        "OpenAI"
      ),
    /OpenAI returned empty content\. message=quota exceeded type=rate_limit code=rate_limit_exceeded/
  );
});
