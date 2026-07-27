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

const targetCompany = "安克创新";
const targetJobTitle = "组织策略与数据分析方向（人力资源发展岗）";
const targetOwnerId = process.env.DEMO_OWNER_ID || process.env.TARGET_OWNER_ID;
const outputPath = process.env.ANKER_DEMO_OUTPUT || "/private/tmp/anker-new-report.json";

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function main() {
  let query = supabase
    .from("interview_history")
    .select("*")
    .eq("company", targetCompany)
    .eq("job_title", targetJobTitle)
    .is("deleted_at", null)
    .order("reported_at", { ascending: false })
    .limit(1);

  if (targetOwnerId) query = query.eq("owner_id", targetOwnerId);

  const { data, error } = await query.single();
  if (error || !data) {
    throw new Error(`Target interview history not found: ${error?.message ?? "empty result"}`);
  }

  const sessionId = data.session_id as string;
  const sessionPlan = await loadSessionPlan(sessionId, data.owner_id as string);
  const session: Session = {
    id: sessionId,
    ownerId: data.owner_id as string,
    resume: data.resume as string,
    company: data.company as string,
    jobTitle: data.job_title as string,
    jd: data.jd as string,
    interviewType: data.interview_type as Session["interviewType"],
    language: data.language as Session["language"],
    persona: data.persona as Session["persona"],
    difficulty: data.difficulty as Session["difficulty"],
    mode: data.mode as Session["mode"],
    provider: process.env.DEMO_LLM_PROVIDER || process.env.LLM_PROVIDER || "deepseek",
    model: process.env.DEMO_LLM_MODEL || process.env.DEEPSEEK_MODEL || "deepseek-chat",
    thinkingEnabled: false,
    plan: sessionPlan,
    rounds: (data.rounds as Session["rounds"]) || [],
    currentQuestion: null,
    currentIsFollowUp: false,
    status: "finished",
    report: null,
    createdAt: new Date(data.created_at as string).getTime(),
  };

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
    historyId: data.id,
    sessionId,
    company: session.company,
    jobTitle: session.jobTitle,
    interviewType: session.interviewType,
    difficulty: session.difficulty,
    mode: session.mode,
    hasCouncilPlan: Boolean(session.plan?.council),
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

  writeFileSync(outputPath, JSON.stringify({ ...payload, report: nextReport, rounds: session.rounds }, null, 2) + "\n", "utf-8");
  console.log(JSON.stringify(payload, null, 2));
}

async function loadSessionPlan(sessionId: string, ownerId: string): Promise<Session["plan"]> {
  if (!sessionId) return null;
  let query = supabase
    .from("interview_sessions")
    .select("plan")
    .eq("id", sessionId)
    .limit(1);
  if (ownerId) query = query.eq("owner_id", ownerId);
  const { data, error } = await query.maybeSingle();
  if (error || !data) return null;
  return (data.plan as Session["plan"]) || null;
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
