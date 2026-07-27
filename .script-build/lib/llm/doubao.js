"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDoubaoProvider = createDoubaoProvider;
const openai_1 = __importDefault(require("openai"));
require("../proxy");
function createDoubaoProvider(modelOverride) {
    const apiKey = process.env.DOUBAO_LLM_API_KEY || process.env.ARK_API_KEY;
    if (!apiKey) {
        throw new Error("需要在 .env.local 配置 DOUBAO_LLM_API_KEY 或 ARK_API_KEY");
    }
    const client = new openai_1.default({
        apiKey,
        baseURL: process.env.DOUBAO_LLM_BASE_URL ||
            process.env.ARK_BASE_URL ||
            "https://ark.cn-beijing.volces.com/api/v3",
    });
    const model = modelOverride ||
        process.env.DOUBAO_LLM_MODEL ||
        process.env.ARK_MODEL ||
        "doubao-1-5-pro-32k-250115";
    return {
        name: "doubao",
        async completeJSON({ system, messages, thinkingEnabled: _thinkingEnabled, }) {
            const res = await client.chat.completions.create({
                model,
                response_format: { type: "json_object" },
                messages: [
                    {
                        role: "system",
                        content: system +
                            "\n\n严格只返回合法 JSON，不要包含 markdown 代码块或解释说明。",
                    },
                    ...messages.map((m) => ({ role: m.role, content: m.content })),
                ],
            });
            const text = res.choices[0]?.message?.content ?? "";
            return JSON.parse(text);
        },
    };
}
