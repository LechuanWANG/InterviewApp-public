import type { InterviewHistoryRecord } from "../historyStore";
import type { ConsultSession } from "./types";

export type InterviewMemorySource = {
  id: string;
  title: string;
};

export function buildMemoryContributionSession(
  session: ConsultSession,
  previousSessions: ConsultSession[]
): ConsultSession | null {
  const coveredKeys = collectCoveredInterviewKeys(
    previousSessions.filter((item) => isComparableMemorySession(item, session))
  );
  const records = filterNewInterviewRecords(session.records, coveredKeys);
  if (!records.length) return null;
  return cloneSessionWithRecords(session, records);
}

export function buildMemoryContributionSessions(sessions: ConsultSession[]): ConsultSession[] {
  const coveredKeys = new Set<string>();
  const result: ConsultSession[] = [];
  for (const session of sessions) {
    const records = filterNewInterviewRecords(session.records, coveredKeys);
    addSessionInterviewKeys(coveredKeys, session);
    if (!records.length) continue;
    result.push(cloneSessionWithRecords(session, records));
  }
  return result;
}

export function interviewMemorySourcesForSession(session: ConsultSession): InterviewMemorySource[] {
  const sources: InterviewMemorySource[] = [];
  const seen = new Set<string>();
  for (const record of session.records) {
    const key = primaryInterviewMemoryKey(record);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    sources.push({
      id: `interview:${key}`,
      title: `${record.jobTitle} · ${record.company}`,
    });
  }
  if (sources.length) return sources;
  for (const id of session.selectedInterviewSessionIds || []) {
    const key = normalizeInterviewMemoryKey(id);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    sources.push({
      id: `interview:${key}`,
      title: "历史面试",
    });
  }
  return sources;
}

export function memoryItemInterviewKeys(metadata: Record<string, unknown>): string[] {
  const keys = new Set<string>();
  addUnknownInterviewIds(keys, metadata.interviewIds);
  addUnknownInterviewIds(keys, metadata.interviewId);
  addUnknownInterviewIds(keys, metadata.interviewSessionId);
  return Array.from(keys);
}

export function isSavedMemorySession(session: ConsultSession): boolean {
  return session.memoryEnabled !== false &&
    getMemorySaveStatus(session) === "saved" &&
    (session.status === "completed" || !!session.summary);
}

function isComparableMemorySession(candidate: ConsultSession, current: ConsultSession): boolean {
  return candidate.id !== current.id &&
    candidate.ownerId === current.ownerId &&
    candidate.memoryProfileId === current.memoryProfileId &&
    isSavedMemorySession(candidate);
}

function collectCoveredInterviewKeys(sessions: ConsultSession[]): Set<string> {
  const keys = new Set<string>();
  for (const session of sessions) {
    addSessionInterviewKeys(keys, session);
  }
  return keys;
}

function addSessionInterviewKeys(keys: Set<string>, session: ConsultSession) {
  for (const record of session.records) {
    for (const key of interviewMemoryKeysForRecord(record)) keys.add(key);
  }
  addUnknownInterviewIds(keys, session.selectedInterviewSessionIds);
}

function filterNewInterviewRecords(
  records: InterviewHistoryRecord[],
  coveredKeys: Set<string>
): InterviewHistoryRecord[] {
  const nextRecords: InterviewHistoryRecord[] = [];
  const localKeys = new Set<string>();
  for (const record of records) {
    const keys = interviewMemoryKeysForRecord(record);
    if (keys.some((key) => coveredKeys.has(key) || localKeys.has(key))) continue;
    nextRecords.push(record);
    for (const key of keys) localKeys.add(key);
  }
  return nextRecords;
}

function cloneSessionWithRecords(
  session: ConsultSession,
  records: InterviewHistoryRecord[]
): ConsultSession {
  return {
    ...session,
    records,
    selectedInterviewSessionIds: records.map((record) => record.id),
    summaryMode: records.length === 1 ? "single_session" : "multi_session",
  };
}

function interviewMemoryKeysForRecord(record: InterviewHistoryRecord): string[] {
  return uniqueKeys([record.id, record.sessionId]);
}

function primaryInterviewMemoryKey(record: InterviewHistoryRecord): string {
  return normalizeInterviewMemoryKey(record.id) || normalizeInterviewMemoryKey(record.sessionId);
}

function addUnknownInterviewIds(keys: Set<string>, value: unknown) {
  if (Array.isArray(value)) {
    for (const item of value) addUnknownInterviewIds(keys, item);
    return;
  }
  if (typeof value !== "string") return;
  const key = normalizeInterviewMemoryKey(value);
  if (key) keys.add(key);
}

function uniqueKeys(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map(normalizeInterviewMemoryKey).filter(Boolean)));
}

function normalizeInterviewMemoryKey(value: string | null | undefined): string {
  return value?.trim().toLowerCase() || "";
}

function getMemorySaveStatus(session: ConsultSession): "pending" | "saved" | "excluded" {
  if (
    session.memorySaveStatus === "pending" ||
    session.memorySaveStatus === "saved" ||
    session.memorySaveStatus === "excluded"
  ) {
    return session.memorySaveStatus;
  }
  return session.memoryEnabled === false ? "excluded" : "saved";
}
