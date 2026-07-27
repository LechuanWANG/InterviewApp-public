import { NextRequest, NextResponse } from "next/server";
import { listConsultSessions } from "@/lib/consultation/store";
import { listInterviewRecords } from "@/lib/historyStore";
import {
  buildConsultMemoryIssues,
  markIssueResolved,
  restoreIssueToMemory,
} from "@/lib/consultation/issues";
import { getCurrentUserId, unauthorizedJson, userMemoryProfileId } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  const ownerId = getCurrentUserId();
  if (!ownerId) return unauthorizedJson();
  const profileId = userMemoryProfileId(ownerId);
  const [sessions, records] = await Promise.all([
    listConsultSessions(ownerId),
    listInterviewRecords(ownerId),
  ]);
  const issues = await buildConsultMemoryIssues({
    sessions,
    interviewRecords: records,
    profileId,
    ownerId,
  });
  return NextResponse.json(issues);
}

export async function POST(req: NextRequest) {
  try {
    const ownerId = getCurrentUserId();
    if (!ownerId) return unauthorizedJson();
    const profileId = userMemoryProfileId(ownerId);
    const body = (await req.json()) as {
      action?: "resolve" | "restore";
      normalizedKey?: string;
      label?: string;
    };
    if (!body.normalizedKey) {
      return NextResponse.json({ error: "normalizedKey required" }, { status: 400 });
    }
    if (body.action === "restore") {
      await restoreIssueToMemory({ normalizedKey: body.normalizedKey, profileId, ownerId });
    } else {
      await markIssueResolved({
        normalizedKey: body.normalizedKey,
        label: body.label || body.normalizedKey,
        profileId,
        ownerId,
      });
    }

    const [sessions, records] = await Promise.all([
      listConsultSessions(ownerId),
      listInterviewRecords(ownerId),
    ]);
    const issues = await buildConsultMemoryIssues({
      sessions,
      interviewRecords: records,
      profileId,
      ownerId,
    });
    return NextResponse.json(issues);
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "更新问题记忆失败" },
      { status: 500 }
    );
  }
}
