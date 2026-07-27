"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createOpenAIProvider = createOpenAIProvider;
const openai_1 = __importDefault(require("openai"));
require("../proxy");
const json_1 = require("./json");
function createOpenAIProvider(modelOverride) {
    const client = new openai_1.default({
        apiKey: process.env.OPENAI_API_KEY,
        baseURL: process.env.OPENAI_BASE_URL || undefined,
    });
    const model = modelOverride || process.env.OPENAI_MODEL || "gpt-4o";
    return {
        name: "openai",
        async completeJSON({ system, messages, thinkingEnabled: _thinkingEnabled, }) {
            const res = await client.chat.completions.create({
                model,
                response_format: { type: "json_object" },
                messages: [
                    { role: "system", content: system + "\n\nReturn only valid JSON." },
                    ...messages.map((m) => ({ role: m.role, content: m.content })),
                ],
            });
            const text = res.choices[0]?.message?.content ?? "";
            return (0, json_1.parseJSONWithRepair)(text, async (broken) => {
                const fixed = await client.chat.completions.create({
                    model,
                    response_format: { type: "json_object" },
                    messages: [
                        {
                            role: "system",
                            content: "You are a JSON repairer. Return only valid JSON. Do not include markdown or explanations.",
                        },
                        {
                            role: "user",
                            content: "Repair the following content into valid JSON while preserving the original meaning and fields:\n\n" +
                                broken,
                        },
                    ],
                });
                return fixed.choices[0]?.message?.content ?? "";
            });
        },
    };
}
