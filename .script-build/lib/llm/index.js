"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLLM = getLLM;
const anthropic_1 = require("./anthropic");
const openai_1 = require("./openai");
const deepseek_1 = require("./deepseek");
const doubao_1 = require("./doubao");
function getLLM(override = {}) {
    const provider = (override.provider || process.env.LLM_PROVIDER || "anthropic").toLowerCase();
    const model = override.model;
    if (provider === "openai")
        return (0, openai_1.createOpenAIProvider)(model);
    if (provider === "deepseek")
        return (0, deepseek_1.createDeepSeekProvider)(model);
    if (provider === "doubao")
        return (0, doubao_1.createDoubaoProvider)(model);
    return (0, anthropic_1.createAnthropicProvider)(model);
}
