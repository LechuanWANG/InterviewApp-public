import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId, unauthorizedJson } from "@/lib/auth";
import {
  ensureGroupReport,
  ensureGroupReportAnnotations,
} from "@/lib/groupInterview/reportService";
import { getGroupSession } from "@/lib/groupInterview/store";
import type { GroupInterviewSession, GroupReport } from "@/lib/groupInterview/types";

export const runtime = "nodejs";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ownerId = getCurrentUserId();
    if (!ownerId) return unauthorizedJson();

    const session = await getGroupSession(params.id, ownerId);
    if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });

    const reportSession = session.report ? session : await ensureGroupReport(session);
    const annotatedSession = await ensureGroupReportAnnotations(reportSession);
    const status = annotatedSession.report?.annotationStatus ?? "failed";
    return NextResponse.json(buildAnnotationPayload(annotatedSession, status !== "running"), {
      status: status === "running" ? 202 : 200,
    });
  } catch (error) {
    console.error("group annotations failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "server error" },
      { status: 500 }
    );
  }
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ownerId = getCurrentUserId();
    if (!ownerId) return unauthorizedJson();

    const session = await getGroupSession(params.id, ownerId);
    if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });

    return NextResponse.json(buildAnnotationPayload(session, true));
  } catch (error) {
    console.error("group annotations status failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "server error" },
      { status: 500 }
    );
  }
}

function buildAnnotationPayload(session: GroupInterviewSession, includeReport: boolean) {
  const report = session.report;
  const annotationStatus = report?.annotationStatus ?? "pending";
  const startedAt = report?.annotationStartedAt;
  const finishedAt = report?.annotationFinishedAt;
  return {
    report: includeReport ? report : undefined,
    annotationStatus,
    annotationStartedAt: startedAt,
    annotationFinishedAt: finishedAt,
    annotationElapsedMs: startedAt ? (finishedAt ?? Date.now()) - startedAt : 0,
    annotationError: report?.annotationError,
    annotationCounts: countAnnotations(report),
  };
}

function countAnnotations(report: GroupReport | null | undefined) {
  return {
    turnReviews: report?.turnReviews?.length ?? 0,
    turnAnnotations: report?.turnAnnotations?.length ?? 0,
  };
}
