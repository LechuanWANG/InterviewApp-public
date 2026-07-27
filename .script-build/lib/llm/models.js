"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_MODEL_ID = exports.MODEL_OPTIONS = void 0;
exports.findModel = findModel;
exports.MODEL_OPTIONS = [
    {
        id: "deepseek-v4-pro",
        label: "DeepSeek V4 Pro",
        provider: "deepseek",
        model: "deepseek-reasoner",
        note: "高质量对话&分析",
    },
    {
        id: "deepseek-v4-flash",
        label: "DeepSeek V4 Flash",
        provider: "deepseek",
        model: "deepseek-chat",
        note: "快速响应",
    },
];
exports.DEFAULT_MODEL_ID = "deepseek-v4-pro";
function findModel(id) {
    return exports.MODEL_OPTIONS.find((m) => m.id === id) ?? exports.MODEL_OPTIONS[0];
}
