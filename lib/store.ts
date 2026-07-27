import { randomUUID } from "crypto";
import { getSupabaseClient } from "./supabase";
import type { Round, Session } from "./types";

export async function createSession(
  data: Omit<Session, "id" | "plan" | "rounds" | "status" | "currentQuestion" | "currentIsFollowUp" | "report" | "createdAt">
): Promise<Session> {
  const supabase = getSupabaseClient();
  const now = Date.now();
  const session: Session = {
    ...data,
    id: randomUUID(),
    plan: null,
    rounds: [],
    currentQuestion: null,
    currentIsFollowUp: false,
    status: "created",
    report: null,
    createdAt: now,
  };

  const { error } = await supabase.from("interview_sessions").insert({
    id: session.id,
    owner_id: session.ownerId,
    resume: session.resume,
    company: session.company,
    job_title: session.jobTitle,
    jd: session.jd,
    interview_type: session.interviewType,
    language: session.language,
    persona: session.persona,
    difficulty: session.difficulty,
    mode: session.mode,
    provider: session.provider,
    model: session.model,
    thinking_enabled: session.thinkingEnabled,
    plan: session.plan,
    rounds: session.rounds,
    current_question: session.currentQuestion,
    current_is_follow_up: session.currentIsFollowUp,
    status: session.status,
    report: session.report,
    created_at: new Date(session.createdAt).toISOString(),
  });

  if (error) throw new Error(`Failed to create session: ${error.message}`);
  return session;
}

export async function getSession(id: string, ownerId?: string): Promise<Session | undefined> {
  const supabase = getSupabaseClient();
  let query = supabase
    .from("interview_sessions")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null);
  if (ownerId) query = query.eq("owner_id", ownerId);
  const { data, error } = await query.single();

  if (error || !data) return undefined;
  return rowToSession(data);
}

export async function updateSession(id: string, patch: Partial<Session>, ownerId?: string): Promise<Session | undefined> {
  const supabase = getSupabaseClient();
  const dbPatch: Record<string, unknown> = {};

  if (patch.plan !== undefined) dbPatch.plan = patch.plan;
  if (patch.rounds !== undefined) dbPatch.rounds = patch.rounds;
  if (patch.currentQuestion !== undefined) dbPatch.current_question = patch.currentQuestion;
  if (patch.currentIsFollowUp !== undefined) dbPatch.current_is_follow_up = patch.currentIsFollowUp;
  if (patch.status !== undefined) dbPatch.status = patch.status;
  if (patch.report !== undefined) dbPatch.report = patch.report;

  if (Object.keys(dbPatch).length === 0) {
    return getSession(id, ownerId);
  }

  let query = supabase
    .from("interview_sessions")
    .update(dbPatch)
    .eq("id", id)
    .is("deleted_at", null);
  if (ownerId) query = query.eq("owner_id", ownerId);
  const { data, error } = await query.select("*").single();

  if (error || !data) return undefined;
  return rowToSession(data);
}

function rowToSession(row: Record<string, unknown>): Session {
  return {
    id: row.id as string,
    ownerId: (row.owner_id as string) || "",
    resume: row.resume as string,
    company: row.company as string,
    jobTitle: row.job_title as string,
    jd: row.jd as string,
    interviewType: row.interview_type as Session["interviewType"],
    language: row.language as Session["language"],
    persona: row.persona as Session["persona"],
    difficulty: row.difficulty as Session["difficulty"],
    mode: row.mode as Session["mode"],
    provider: row.provider as string,
    model: row.model as string,
    thinkingEnabled: (row.thinking_enabled as boolean) || false,
    plan: (row.plan as Session["plan"]) || null,
    rounds: (row.rounds as Round[]) || [],
    currentQuestion: (row.current_question as string) || null,
    currentIsFollowUp: (row.current_is_follow_up as boolean) || false,
    status: row.status as Session["status"],
    report: (row.report as Session["report"]) || null,
    createdAt: new Date(row.created_at as string).getTime(),
  };
}
