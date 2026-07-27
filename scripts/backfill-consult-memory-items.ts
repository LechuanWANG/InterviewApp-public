import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { ConsultMemorySaveStatus, ConsultMessage, ConsultSession, ConsultSummary } from "../lib/consultation/types";
import { DEFAULT_CONSULT_PROFILE_ID } from "../lib/consultation/memory";
import {
  extractConsultMemoryItemsFromSession,
  syncConsultSessionMemoryItems,
} from "../lib/consultation/memoryItems";
import {
  rebuildConsultMemoryGraphFromSessions,
  updateConsultMemoryGraphFromSession,
} from "../lib/consultation/memoryGraph";
import { rebuildConsultMemoryProfileFromSessions } from "../lib/consultation/memoryProfile";
import { buildMemoryContributionSessions } from "../lib/consultation/memoryCoverage";
import type { InterviewHistoryRecord } from "../lib/historyStore";

loadEnvLocal();

const args = new Set(process.argv.slice(2));
const write = args.has("--write");
const ownerIdFilter = valueArg("--owner-id");
const limit = numberArg("--limit");
const skipGraph = args.has("--skip-graph");
const rebuildGraph = args.has("--rebuild-graph");
const useLlmGraph = args.has("--use-llm-graph");

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function main() {
  await assertMemoryTableExists();
  if (!skipGraph) await assertGraphTablesExist();

  const sessions = await fetchEligibleConsultSessions();
  const limitedSessions = typeof limit === "number" ? sessions.slice(0, limit) : sessions;
  const graphMode = skipGraph ? "skip" : rebuildGraph ? "full-rebuild" : "incremental";
  const contributionSessions = groupSessionsByOwnerProfile(limitedSessions)
    .flatMap((group) => buildMemoryContributionSessions(sortSessionsForMemory(group.sessions)));

  const dryRunItems = contributionSessions.flatMap((session) => extractConsultMemoryItemsFromSession(session));
  const byType = dryRunItems.reduce<Record<string, number>>((acc, item) => {
    acc[item.type] = (acc[item.type] || 0) + 1;
    return acc;
  }, {});

  if (!write) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          mode: "dry-run",
          hint: "Add --write to actually backfill user_memory_items. Add --rebuild-graph for a clean full graph rebuild.",
          ownerId: ownerIdFilter || null,
          sessions: limitedSessions.length,
          memoryItems: dryRunItems.length,
          byType,
          graphMode,
          graphUsesLLM: graphMode !== "skip" && useLlmGraph,
          contributionSessions: contributionSessions.length,
        },
        null,
        2
      )
    );
    return;
  }

  let syncedSessions = 0;
  let syncedItems = 0;
  let syncedGraphSessions = 0;
  let rebuiltProfiles = 0;
  const graphRebuilds: Array<{
    ownerId: string;
    profileId: string;
    sessions: number;
    sourceSessionCount: number;
    nodes: number;
    edges: number;
  }> = [];
  const failures: Array<{ sessionId: string; message: string }> = [];

  for (const group of groupSessionsByOwnerProfile(limitedSessions)) {
    const sortedSessions = sortSessionsForMemory(group.sessions);
    const contributionGroupSessions = buildMemoryContributionSessions(sortedSessions);
    try {
      await deleteConsultationMemoryItemsForGroup(group.ownerId, group.profileId);
      for (const session of contributionGroupSessions) {
        const items = extractConsultMemoryItemsFromSession(session);
        if (!items.length) continue;
        await syncConsultSessionMemoryItems(session);
        await markSessionSaved(session);
        session.memorySaveStatus = "saved";
        if (!skipGraph && !rebuildGraph) {
          await updateConsultMemoryGraphFromSession({
            session,
            llm: { provider: session.provider, model: session.model },
            useLLM: false,
          });
          syncedGraphSessions += 1;
        }
        syncedSessions += 1;
        syncedItems += items.length;
      }
      const first = sortedSessions[0];
      if (first) {
        await rebuildConsultMemoryProfileFromSessions({
          ownerId: group.ownerId,
          profileId: group.profileId,
          sessions: sortedSessions,
          llm: { provider: first.provider, model: first.model },
        });
        rebuiltProfiles += 1;
      }
    } catch (error) {
      failures.push({
        sessionId: `${group.ownerId}:${group.profileId}`,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (!skipGraph && rebuildGraph) {
    for (const group of groupSessionsByOwnerProfile(limitedSessions)) {
      const first = group.sessions[0];
      if (!first) continue;
      const snapshot = await rebuildConsultMemoryGraphFromSessions({
        ownerId: group.ownerId,
        profileId: group.profileId,
        sessions: group.sessions,
        llm: { provider: first.provider, model: first.model },
        useLLM: useLlmGraph ? undefined : false,
      });
      graphRebuilds.push({
        ownerId: group.ownerId,
        profileId: group.profileId,
        sessions: group.sessions.length,
        sourceSessionCount: snapshot?.sourceSessionCount || 0,
        nodes: snapshot?.nodes.length || 0,
        edges: snapshot?.edges.length || 0,
      });
      syncedGraphSessions += group.sessions.length;
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: failures.length === 0,
        mode: "write",
        ownerId: ownerIdFilter || null,
        graphMode,
        graphUsesLLM: graphMode !== "skip" && useLlmGraph,
        scannedSessions: limitedSessions.length,
        contributionSessions: contributionSessions.length,
        syncedSessions,
        syncedItems,
        syncedGraphSessions,
        rebuiltProfiles,
        graphRebuilds,
        failures,
      },
      null,
      2
    )
  );

  if (failures.length) process.exitCode = 1;
}

async function fetchEligibleConsultSessions(): Promise<ConsultSession[]> {
  let query = supabase
    .from("consult_sessions")
    .select("*")
    .eq("memory_enabled", true)
    .is("deleted_at", null)
    .not("summary", "is", null)
    .order("ended_at", { ascending: false, nullsFirst: false });

  if (ownerIdFilter) query = query.eq("owner_id", ownerIdFilter);

  const { data, error } = await query;
  if (error) throw new Error(`Failed to fetch consult_sessions: ${error.message}`);
  if (!data?.length) return [];

  const sessionIds = data.map((row) => row.id as string);
  let messageQuery = supabase
    .from("consult_messages")
    .select("*")
    .in("session_id", sessionIds)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (ownerIdFilter) messageQuery = messageQuery.eq("owner_id", ownerIdFilter);
  const { data: messageRows, error: messageError } = await messageQuery;
  if (messageError) throw new Error(`Failed to fetch consult_messages: ${messageError.message}`);

  const messagesBySession = new Map<string, ConsultMessage[]>();
  for (const message of messageRows || []) {
    const sessionId = message.session_id as string;
    if (!messagesBySession.has(sessionId)) messagesBySession.set(sessionId, []);
    messagesBySession.get(sessionId)!.push({
      id: message.id as string,
      ownerId: (message.owner_id as string) || "",
      role: message.role as ConsultMessage["role"],
      content: message.content as string,
      createdAt: new Date(message.created_at as string).getTime(),
    });
  }

  const sessions = data
    .map((row) => rowToSession(row, messagesBySession.get(row.id as string) || []))
    .filter((session) => session.memorySaveStatus !== "excluded" && !!session.summary);

  return sessions;
}

async function assertMemoryTableExists() {
  const { error } = await supabase.from("user_memory_items").select("id").limit(1);
  if (error) {
    const message = error.message || String(error);
    const isNetworkError = /fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i.test(message);
    if (isNetworkError) {
      throw new Error(
        `Cannot connect to Supabase: ${message}. Check SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and your network.`
      );
    }
    throw new Error(`user_memory_items table is not ready: ${message}. Run supabase/20260520_user_memory_items.sql first.`);
  }
}

async function assertGraphTablesExist() {
  const { error } = await supabase.from("consult_memory_graph_nodes").select("id").limit(1);
  if (error) {
    const message = error.message || String(error);
    const isNetworkError = /fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i.test(message);
    if (isNetworkError) {
      throw new Error(
        `Cannot connect to Supabase: ${message}. Check SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and your network.`
      );
    }
    throw new Error(
      `consult_memory_graph_nodes table is not ready: ${message}. Run supabase/20260523_consult_memory_graph.sql first.`
    );
  }
}

async function markSessionSaved(session: ConsultSession) {
  if (session.memorySaveStatus === "saved") return;
  const { error } = await supabase
    .from("consult_sessions")
    .update({
      memory_save_status: "saved",
      updated_at: new Date().toISOString(),
    })
    .eq("id", session.id)
    .eq("owner_id", session.ownerId)
    .is("deleted_at", null);
  if (error) throw new Error(`Failed to mark consult session saved: ${error.message}`);
}

async function deleteConsultationMemoryItemsForGroup(ownerId: string, profileId: string) {
  const { error } = await supabase
    .from("user_memory_items")
    .delete()
    .eq("owner_id", ownerId)
    .eq("profile_id", profileId)
    .eq("source_type", "consultation");
  if (error) throw new Error(`Failed to clear consultation memory items: ${error.message}`);
}

function sortSessionsForMemory(sessions: ConsultSession[]): ConsultSession[] {
  return [...sessions].sort(
    (left, right) =>
      (left.endedAt || left.updatedAt || left.createdAt) -
      (right.endedAt || right.updatedAt || right.createdAt)
  );
}

function rowToSession(row: Record<string, unknown>, messages: ConsultMessage[]): ConsultSession {
  const now = new Date(row.updated_at as string || row.created_at as string || Date.now()).getTime();
  return {
    id: row.id as string,
    ownerId: (row.owner_id as string) || "",
    selectedInterviewSessionIds: (row.selected_interview_session_ids as string[]) || [],
    summaryMode: row.summary_mode as ConsultSession["summaryMode"],
    goal: row.goal as ConsultSession["goal"],
    mentorType: "career_strategist",
    memoryProfileId: (row.memory_profile_id as string) || DEFAULT_CONSULT_PROFILE_ID,
    memoryEnabled: (row.memory_enabled as boolean) ?? true,
    memorySaveStatus: (row.memory_save_status as ConsultMemorySaveStatus) || "saved",
    provider: (row.provider as string) || "deepseek",
    model: (row.model as string) || "deepseek-chat",
    status: row.status as ConsultSession["status"],
    endedBy: (row.ended_by as ConsultSession["endedBy"]) || null,
    records: (row.records as InterviewHistoryRecord[]) || [],
    messages,
    summary: (row.summary as ConsultSummary) || null,
    createdAt: new Date(row.created_at as string || now).getTime(),
    updatedAt: now,
    endedAt: row.ended_at ? new Date(row.ended_at as string).getTime() : undefined,
  };
}

function groupSessionsByOwnerProfile(sessions: ConsultSession[]): Array<{
  ownerId: string;
  profileId: string;
  sessions: ConsultSession[];
}> {
  const groups = new Map<string, { ownerId: string; profileId: string; sessions: ConsultSession[] }>();
  for (const session of sessions) {
    const key = `${session.ownerId}\u0000${session.memoryProfileId}`;
    if (!groups.has(key)) {
      groups.set(key, {
        ownerId: session.ownerId,
        profileId: session.memoryProfileId,
        sessions: [],
      });
    }
    groups.get(key)!.sessions.push(session);
  }
  return Array.from(groups.values());
}

function valueArg(name: string): string | undefined {
  const prefix = `${name}=`;
  const match = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length).trim() || undefined : undefined;
}

function numberArg(name: string): number | undefined {
  const value = valueArg(name);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
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
