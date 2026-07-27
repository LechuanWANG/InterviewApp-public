"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isClosingInterviewPrompt = isClosingInterviewPrompt;
exports.closingMessageForLanguage = closingMessageForLanguage;
function isClosingInterviewPrompt(text) {
    const normalized = text.trim().toLowerCase();
    if (!normalized)
        return false;
    return [
        /本轮面试.{0,20}(到这里|到此|结束|先到这)/,
        /本次面试.{0,20}(到这里|到此|结束|先到这)/,
        /今天.{0,20}(先到这里|到这里|到此|结束)/,
        /面试.{0,20}(到这里|到此|结束|先到这)/,
        /(到这里|到此|先到这里|先到这).{0,12}(结束|可以了|就可以了)/,
        /感谢.{0,20}(参加|配合|回答|时间)/,
        /谢谢.{0,20}(参加|配合|回答|时间)/,
        /后续.{0,12}(通知|联系|结果|反馈)/,
        /等待.{0,12}(通知|联系|结果|反馈)/,
        /we\s+can\s+(stop|end|wrap\s+up)\s+(here|the\s+interview)/i,
        /this\s+(interview|round)\s+is\s+(over|complete|completed|finished)/i,
        /that\s+(will|would)\s+be\s+all\s+for\s+(today|this\s+interview)/i,
        /thank\s+you\s+for\s+(your\s+time|participating|answering|joining)/i,
        /we\s+will\s+(follow\s+up|get\s+back\s+to\s+you)/i,
    ].some((pattern) => pattern.test(normalized));
}
function closingMessageForLanguage(language) {
    return language === "en"
        ? "Thanks, we can stop here for this interview."
        : "好的，本轮面试先到这里。感谢你的回答，接下来可以生成本次面试报告。";
}
