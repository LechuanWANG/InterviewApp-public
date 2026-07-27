"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decideNextQuestion = decideNextQuestion;
const langgraphAgent_1 = require("../interview/langgraphAgent");
async function decideNextQuestion(session) {
    return (0, langgraphAgent_1.runInterviewAgent)(session);
}
