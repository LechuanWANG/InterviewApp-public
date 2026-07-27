import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();
loadEnvFile(join(ROOT, ".env.local"));
loadEnvFile(join(ROOT, ".env"));

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local / environment.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

const interviewHistoryPath = join(ROOT, "data", "interview-history.json");
const consultSessionsPath = join(ROOT, "data", "consult-sessions.json");

const interviewRecords = readJSON(interviewHistoryPath).records || [];
const consultSessions = readJSON(consultSessionsPath).sessions || [];
const defaultOwnerId = process.env.DEMO_OWNER_ID || "demo-user";

const interviewRows = interviewRecords.map((record) => ({
  id: toDatabaseId(record.id),
  owner_id: record.ownerId || defaultOwnerId,
  session_id: toDatabaseId(record.sessionId || record.id),
  resume: record.resume,
  company: record.company,
  job_title: record.jobTitle,
  jd: record.jd,
  interview_type: record.interviewType,
  language: record.language,
  persona: record.persona,
  difficulty: record.difficulty,
  mode: record.mode,
  rounds: record.rounds || [],
  report: record.report,
  created_at: toISOString(record.createdAt),
  reported_at: toISOString(record.reportedAt),
}));

const interviewSessionRows = interviewRecords.map((record) => ({
  id: toDatabaseId(record.sessionId || record.id),
  owner_id: record.ownerId || defaultOwnerId,
  resume: record.resume,
  company: record.company,
  job_title: record.jobTitle,
  jd: record.jd,
  interview_type: record.interviewType,
  language: record.language,
  persona: record.persona,
  difficulty: record.difficulty,
  mode: record.mode,
  provider: "deepseek",
  model: "deepseek-reasoner",
  thinking_enabled: false,
  plan: null,
  rounds: record.rounds || [],
  current_question: null,
  current_is_follow_up: false,
  status: "finished",
  report: record.report,
  created_at: toISOString(record.createdAt),
}));

const consultSessionRows = consultSessions.map((session) => ({
  id: session.id,
  owner_id: session.ownerId || defaultOwnerId,
  selected_interview_session_ids: (session.selectedInterviewSessionIds || []).map(toDatabaseId),
  summary_mode: session.summaryMode,
  goal: session.goal,
  mentor_type: session.mentorType || "career_strategist",
  memory_profile_id: session.memoryProfileId || "local-default-user",
  memory_enabled: session.memoryEnabled ?? true,
  memory_save_status: session.memorySaveStatus || "saved",
  provider: session.provider || "deepseek",
  model: session.model || "deepseek-reasoner",
  status: session.status || "completed",
  ended_by: session.endedBy || null,
  records: session.records || [],
  summary: session.summary || null,
  created_at: toISOString(session.createdAt),
  updated_at: toISOString(session.updatedAt || session.createdAt),
  ended_at: session.endedAt ? toISOString(session.endedAt) : null,
}));

const consultMessageRows = consultSessions.flatMap((session) =>
  (session.messages || []).map((message) => ({
    id: message.id,
    owner_id: message.ownerId || session.ownerId || defaultOwnerId,
    session_id: session.id,
    role: message.role,
    content: message.content,
    created_at: toISOString(message.createdAt || session.createdAt),
  }))
);

await upsertRows("interview_sessions", interviewSessionRows, "id");
await upsertRows("interview_history", interviewRows, "id");
await upsertRows("consult_sessions", consultSessionRows, "id");
await upsertRows("consult_messages", consultMessageRows, "id");

console.log(
  JSON.stringify(
    {
      ok: true,
      synced: {
        interviewSessions: interviewSessionRows.length,
        interviewHistory: interviewRows.length,
        consultSessions: consultSessionRows.length,
        consultMessages: consultMessageRows.length,
      },
    },
    null,
    2
  )
);

async function upsertRows(table, rows, onConflict) {
  if (!rows.length) return;
  const { error } = await supabase.from(table).upsert(rows, { onConflict });
  if (error) {
    throw new Error(`Failed to upsert ${table}: ${error.message}`);
  }
}

function readJSON(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function toISOString(timestamp) {
  return new Date(timestamp || Date.now()).toISOString();
}

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  const raw = readFileSync(path, "utf-8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

function toDatabaseId(id) {
  if (isUUID(id)) return id;
  const hex = createHash("sha1").update(`interview-app-demo:${id}`).digest("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `${((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${hex.slice(18, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

function isUUID(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "")
  );
}
