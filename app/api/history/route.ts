import { NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";
import { listInterviewRecords } from "@/lib/historyStore";
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
  const records = (await listInterviewRecords(ownerId)).map((record) => ({
    id: record.id,
    sessionId: record.sessionId,
    company: record.company,
    jobTitle: record.jobTitle,
    interviewType: record.interviewType,
    reportedAt: record.reportedAt,
    overallBand: record.report.overallBand,
    reportKind: record.report.reportKind || "score",
    mbtiType: record.report.mbtiReport?.mbtiType,
    weaknesses: record.report.weaknesses?.slice(0, 2) ?? [],
    dimensionScores: record.report.dimensionScores,
    roundCount: record.rounds.length,
  }));
  return NextResponse.json({ records }, { headers: NO_STORE_HEADERS });
}
