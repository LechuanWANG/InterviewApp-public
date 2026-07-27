"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureSessionReport = ensureSessionReport;
const historyStore_1 = require("../historyStore");
const annotateAnswers_1 = require("../prompts/annotateAnswers");
const finalReport_1 = require("../prompts/finalReport");
const store_1 = require("../store");
async function ensureSessionReport(session) {
    if (session.report) {
        await (0, historyStore_1.saveInterviewRecord)(session);
        return session;
    }
    if (session.rounds.length === 0) {
        throw new Error("no rounds to score");
    }
    const report = await (0, finalReport_1.generateReport)(session);
    try {
        const annotations = await (0, annotateAnswers_1.annotateAnswers)(session, report);
        report.roundReviews = annotations.roundReviews;
        report.answerAnnotations = annotations.answerAnnotations;
        report.annotationSummaries = annotations.annotationSummaries;
    }
    catch (annotationError) {
        console.warn("answer annotation failed", annotationError);
        report.roundReviews = [];
        report.answerAnnotations = [];
        report.annotationSummaries = [];
    }
    const nextSession = { ...session, report, status: "finished" };
    await (0, store_1.updateSession)(session.id, { report, status: "finished" }, session.ownerId);
    await (0, historyStore_1.saveInterviewRecord)(nextSession);
    return nextSession;
}
