"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseJSONWithRepair = parseJSONWithRepair;
async function parseJSONWithRepair(text, repair) {
    const cleaned = cleanJSONText(text);
    const candidates = unique([
        cleaned,
        extractJSONObject(cleaned),
        normalizeCommonJSONIssues(cleaned),
        normalizeCommonJSONIssues(extractJSONObject(cleaned)),
    ]).filter(Boolean);
    for (const candidate of candidates) {
        const parsed = tryParseJSON(candidate);
        if (parsed !== null)
            return parsed;
    }
    if (repair) {
        const repaired = cleanJSONText(await repair(cleaned));
        const repairedCandidates = unique([
            repaired,
            extractJSONObject(repaired),
            normalizeCommonJSONIssues(repaired),
            normalizeCommonJSONIssues(extractJSONObject(repaired)),
        ]).filter(Boolean);
        for (const candidate of repairedCandidates) {
            const parsed = tryParseJSON(candidate);
            if (parsed !== null)
                return parsed;
        }
    }
    throw new Error("LLM did not return valid JSON: " + text.slice(0, 300));
}
function tryParseJSON(text) {
    if (!text)
        return null;
    try {
        return JSON.parse(text);
    }
    catch {
        return null;
    }
}
function cleanJSONText(text) {
    return text
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "")
        .trim();
}
function extractJSONObject(text) {
    const match = text.match(/\{[\s\S]*\}/);
    return match?.[0]?.trim() ?? "";
}
function normalizeCommonJSONIssues(text) {
    if (!text)
        return text;
    return text
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .replace(/,\s*([}\]])/g, "$1");
}
function unique(values) {
    return Array.from(new Set(values));
}
