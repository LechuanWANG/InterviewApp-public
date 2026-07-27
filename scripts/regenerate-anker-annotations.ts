import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { annotateAnswers } from "../lib/prompts/annotateAnswers";
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

  const report = data.report as Report;
  const session: Session = {
    id: data.session_id as string,
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
    plan: null,
    rounds: (data.rounds as Session["rounds"]) || [],
    currentQuestion: null,
    currentIsFollowUp: false,
    status: "finished",
    report,
    createdAt: new Date(data.created_at as string).getTime(),
  };

  const annotations = await annotateAnswers(session, report);
  const nextReport: Report = {
    ...report,
    roundReviews: annotations.roundReviews,
    answerAnnotations: annotations.answerAnnotations,
    annotationSummaries: annotations.annotationSummaries,
  };

  const historyUpdate = await supabase
    .from("interview_history")
    .update({ report: nextReport })
    .eq("id", data.id as string)
    .is("deleted_at", null)
    .select("id")
    .single();
  if (historyUpdate.error) {
    throw new Error(`Failed to update interview_history: ${historyUpdate.error.message}`);
  }

  const sessionId = data.session_id as string;
  if (sessionId) {
    const sessionUpdate = await supabase
      .from("interview_sessions")
      .update({ report: nextReport })
      .eq("id", sessionId)
      .is("deleted_at", null)
      .select("id")
      .maybeSingle();
    if (sessionUpdate.error) {
      throw new Error(`Failed to update interview_sessions: ${sessionUpdate.error.message}`);
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        historyId: data.id,
        sessionId,
        rounds: session.rounds.length,
        roundReviews: annotations.roundReviews.length,
        answerAnnotations: annotations.answerAnnotations.length,
        annotationSummaries: annotations.annotationSummaries.length,
      },
      null,
      2
    )
  );
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
