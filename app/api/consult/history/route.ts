import { NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";
import { listConsultSessions } from "@/lib/consultation/store";
import { getCurrentUserId, unauthorizedJson } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
};

export async function GET() {
  noStore();
  const ownerId = getCurrentUserId();
  if (!ownerId) return unauthorizedJson();
  const sessions = (await listConsultSessions(ownerId)).map((session) => {
    const lastMessage = [...session.messages].reverse()[0];
    return {
      id: session.id,
      goal: session.goal,
      status: session.status,
      memorySaveStatus: session.memorySaveStatus ||
        (session.memoryEnabled === false
          ? "excluded"
          : session.status === "completed" || session.summary
            ? "saved"
            : "pending"),
      summaryMode: session.summaryMode,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      endedAt: session.endedAt ?? null,
      messageCount: session.messages.length,
      latestJudgement: session.summary?.currentJudgement ?? null,
      selectedRecords: session.records.map((record) => ({
        id: record.id,
        company: record.company,
        jobTitle: record.jobTitle,
        interviewType: record.interviewType,
        overallBand: record.report.overallBand,
        reportedAt: record.reportedAt,
      })),
      lastMessagePreview: lastMessage?.content?.slice(0, 140) ?? "",
    };
  });

  return NextResponse.json({ sessions }, { headers: NO_STORE_HEADERS });
}
