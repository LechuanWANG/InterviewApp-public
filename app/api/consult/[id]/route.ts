import { NextRequest, NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";
import {
  deleteConsultSession,
  getConsultSession,
} from "@/lib/consultation/store";
import { buildConsultMemorySnapshot } from "@/lib/consultation/memory";
import { getCurrentUserId, unauthorizedJson } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
};

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  noStore();
  const ownerId = getCurrentUserId();
  if (!ownerId) return unauthorizedJson();
  const session = await getConsultSession(params.id, ownerId);
  if (!session) {
    return NextResponse.json({ error: "consult session not found" }, { status: 404, headers: NO_STORE_HEADERS });
  }
  const memory = await buildConsultMemorySnapshot({
    sessions: [],
    profileId: session.memoryProfileId,
    ownerId: session.memoryEnabled ? ownerId : undefined,
    includeGraph: true,
  });
  return NextResponse.json({
    id: session.id,
    summaryMode: session.summaryMode,
    goal: session.goal,
    memoryEnabled: session.memoryEnabled,
    memorySaveStatus: session.memorySaveStatus ||
      (session.memoryEnabled === false
        ? "excluded"
        : session.status === "completed" || session.summary
          ? "saved"
          : "pending"),
    status: session.status,
    summary: session.summary,
    memory,
    messages: session.messages,
    selectedRecords: session.records.map((record) => ({
      id: record.id,
      company: record.company,
      jobTitle: record.jobTitle,
      overallBand: record.report.overallBand,
      reportedAt: record.reportedAt,
    })),
  }, { headers: NO_STORE_HEADERS });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  noStore();
  const ownerId = getCurrentUserId();
  if (!ownerId) return unauthorizedJson();
  const deleted = await deleteConsultSession(params.id, ownerId);
  return NextResponse.json({ ok: true, deleted }, { headers: NO_STORE_HEADERS });
}
