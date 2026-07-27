"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAnthropicProvider = createAnthropicProvider;
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
require("../proxy");
const json_1 = require("./json");
function createAnthropicProvider(modelOverride) {
    const client = new sdk_1.default({
        apiKey: process.env.ANTHROPIC_API_KEY,
        baseURL: process.env.ANTHROPIC_BASE_URL || undefined,
    });
    const model = modelOverride || process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";
    return {
        name: "anthropic",
        async completeJSON({ system, messages, thinkingEnabled: _thinkingEnabled, }) {
            const res = await client.messages.create({
                model,
                max_tokens: 4096,
                system: system + "\n\n严格只返回合法的 JSON，不要包含任何 markdown 代码块或解释文字。",
                messages: messages.map((m) => ({ role: m.role, content: m.content })),
            });
            const text = res.content
                .filter((b) => b.type === "text")
                .map((b) => b.text)
                .join("");
            return (0, json_1.parseJSONWithRepair)(text, async (broken) => {
                const fixed = await client.messages.create({
                    model,
                    max_tokens: 4096,
                    system: "你是 JSON 修复器。请把用户给出的内容修复成合法 JSON。严格只返回合法 JSON，不要输出解释、不要输出 markdown 代码块。",
                    messages: [
                        {
                            role: "user",
                            content: "请修复下面这段 JSON，使其成为合法 JSON，保留原意与原字段，不要增删无关内容：\n\n" +
                                broken,
                        },
                    ],
                });
                return fixed.content
                    .filter((b) => b.type === "text")
                    .map((b) => b.text)
                    .join("");
            });
        },
    };
}
