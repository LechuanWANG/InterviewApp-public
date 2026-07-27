import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { annotateAnswers } from "../lib/prompts/annotateAnswers";
import { generateReport } from "../lib/prompts/finalReport";
import type { Report, Session } from "../lib/types";

loadEnvLocal();

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const targetOwnerId = process.env.DEMO_OWNER_ID || process.env.TARGET_OWNER_ID;
const targetSessionId = process.env.TARGET_SESSION_ID;
const outputPath = process.env.COUNCIL_DEMO_OUTPUT || "/private/tmp/council-new-report.json";

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function main() {
  const row = targetSessionId
    ? await loadSessionById(targetSessionId)
    : await loadLatestCouncilSession();

  const session = rowToSession(row);
  const report = await generateReport(session);
  const annotations = await annotateAnswers(session, report);
  const nextReport: Report = {
    ...report,
    roundReviews: annotations.roundReviews,
    answerAnnotations: annotations.answerAnnotations,
    annotationSummaries: annotations.annotationSummaries,
    annotationStatus: "ready",
  };

  const payload = {
    ok: true,
    generatedAt: new Date().toISOString(),
    outputPath,
    sessionId: session.id,
    company: session.company,
    jobTitle: session.jobTitle,
    interviewType: session.interviewType,
    difficulty: session.difficulty,
    mode: session.mode,
    provider: session.provider,
    model: session.model,
    hasCouncilPlan: Boolean(session.plan?.council),
    councilSummary: session.plan?.council?.consensus.summary ?? null,
    priorityTopics: session.plan?.council?.consensus.priorityTopics ?? [],
    predictedRisks: session.plan?.council?.consensus.predictedRisks ?? [],
    rounds: session.rounds.length,
    overallBand: nextReport.overallBand,
    rawOverall: nextReport.rawOverall,
    dimensionScores: nextReport.dimensionScores,
    dimensionDetails: nextReport.dimensionDetails,
    strengths: nextReport.strengths,
    weaknesses: nextReport.weaknesses,
    improvementAdvice: nextReport.improvementAdvice,
    topicCoverage: nextReport.topicCoverage,
    roundReviews: nextReport.roundReviews,
    annotationSummaries: nextReport.annotationSummaries,
  };

  writeFileSync(
    outputPath,
    JSON.stringify({ ...payload, report: nextReport, interviewRounds: session.rounds }, null, 2) + "\n",
    "utf-8"
  );
  console.log(JSON.stringify(payload, null, 2));
}

async function loadSessionById(id: string): Promise<Record<string, unknown>> {
  let query = supabase
    .from("interview_sessions")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .limit(1);
  if (targetOwnerId) query = query.eq("owner_id", targetOwnerId);
  const { data, error } = await query.single();
  if (error || !data) {
    throw new Error(`Target session not found: ${error?.message ?? "empty result"}`);
  }
  return data as Record<string, unknown>;
}

async function loadLatestCouncilSession(): Promise<Record<string, unknown>> {
  let query = supabase
    .from("interview_sessions")
    .select("*")
    .not("plan", "is", null)
    .order("created_at", { ascending: false })
    .limit(50);
  if (targetOwnerId) query = query.eq("owner_id", targetOwnerId);

  const { data, error } = await query;
  if (error || !data?.length) {
    throw new Error(`No interview sessions found: ${error?.message ?? "empty result"}`);
  }

  const match = (data as Record<string, unknown>[]).find((row) => {
    const plan = asRecord(row.plan);
    const council = asRecord(plan.council);
    const rounds = Array.isArray(row.rounds) ? row.rounds : [];
    return Boolean(council.consensus) && rounds.length > 0 && row.interview_type !== "behavioral";
  });
  if (!match) {
    throw new Error("No recent non-behavioral interview session with plan.council and rounds was found.");
  }
  return match;
}

function rowToSession(row: Record<string, unknown>): Session {
  return {
    id: String(row.id),
    ownerId: String(row.owner_id),
    resume: String(row.resume ?? ""),
    company: String(row.company ?? ""),
    jobTitle: String(row.job_title ?? ""),
    jd: String(row.jd ?? ""),
    interviewType: row.interview_type as Session["interviewType"],
    language: row.language as Session["language"],
    persona: row.persona as Session["persona"],
    difficulty: row.difficulty as Session["difficulty"],
    mode: row.mode as Session["mode"],
    provider: process.env.DEMO_LLM_PROVIDER || process.env.LLM_PROVIDER || String(row.provider || "deepseek"),
    model: process.env.DEMO_LLM_MODEL || process.env.DEEPSEEK_MODEL || String(row.model || "deepseek-chat"),
    thinkingEnabled: false,
    plan: (row.plan as Session["plan"]) || null,
    rounds: (Array.isArray(row.rounds) ? row.rounds : []) as Session["rounds"],
    currentQuestion: null,
    currentIsFollowUp: false,
    status: "finished",
    report: null,
    createdAt: new Date(String(row.created_at ?? Date.now())).getTime(),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function loadEnvLocal() {
  for (const file of [".env.local", ".env"]) {
    const envPath = join(process.cwd(), file);
    if (!existsSync(envPath)) continue;
    const raw = readFileSync(envPath, "utf-8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const index = trimmed.indexOf("=");
      if (index <= 0) continue;
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
