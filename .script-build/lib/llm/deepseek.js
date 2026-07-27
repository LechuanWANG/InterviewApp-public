"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDeepSeekProvider = createDeepSeekProvider;
const openai_1 = __importDefault(require("openai"));
require("../proxy");
const json_1 = require("./json");
function createDeepSeekProvider(modelOverride) {
    const client = new openai_1.default({
        apiKey: process.env.DEEPSEEK_API_KEY,
        baseURL: "https://api.deepseek.com",
    });
    const model = modelOverride || process.env.DEEPSEEK_MODEL || "deepseek-reasoner";
    return {
        name: "deepseek",
        async completeJSON({ system, messages, thinkingEnabled = false, }) {
            const res = await client.chat.completions.create({
                model,
                max_tokens: 8000,
                extra_body: {
                    thinking: {
                        type: thinkingEnabled ? "enabled" : "disabled",
                    },
                },
                messages: [
                    {
                        role: "system",
                        content: system +
                            "\n\n严格只返回合法的 JSON 对象，不要包含 markdown 代码块、不要包含解释性文字。",
                    },
                    ...messages.map((m) => ({ role: m.role, content: m.content })),
                ],
            });
            const text = res.choices[0]?.message?.content ?? "";
            return (0, json_1.parseJSONWithRepair)(text, async (broken) => {
                const fixed = await client.chat.completions.create({
                    model,
                    max_tokens: 4000,
                    extra_body: {
                        thinking: {
                            type: "disabled",
                        },
                    },
                    messages: [
                        {
                            role: "system",
                            content: "你是 JSON 修复器。严格只返回合法 JSON，不要包含 markdown 代码块，不要解释。",
                        },
                        {
                            role: "user",
                            content: "请修复下面这段 JSON，使其成为合法 JSON，保留原意与原字段，不要增删无关内容：\n\n" +
                                broken,
                        },
                    ],
                });
                return fixed.choices[0]?.message?.content ?? "";
            });
        },
    };
}
