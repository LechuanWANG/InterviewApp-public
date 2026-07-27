import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId, unauthorizedJson } from "@/lib/auth";
import { getGroupSession } from "@/lib/groupInterview/store";
import { ensureGroupReport } from "@/lib/groupInterview/reportService";

export const runtime = "nodejs";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id } = params;
    const ownerId = getCurrentUserId();
    if (!ownerId) return unauthorizedJson();

    const session = await getGroupSession(id, ownerId);
    if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });

    if (session.report) {
      return NextResponse.json({ report: session.report });
    }

    if (session.phase !== "reporting" && session.phase !== "finished") {
      return NextResponse.json(
        { error: `report not allowed in phase ${session.phase}` },
        { status: 400 }
      );
    }

    const updated = await ensureGroupReport(session);
    return NextResponse.json({ report: updated.report });
  } catch (error) {
    console.error("group report failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "server error" },
      { status: 500 }
    );
  }
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  const ownerId = getCurrentUserId();
  if (!ownerId) return unauthorizedJson();

  const session = await getGroupSession(id, ownerId);
  if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });

  return NextResponse.json({
    report: session.report,
    topic: session.topic,
    company: session.company,
    jobTitle: session.jobTitle,
    transcript: session.transcript,
    members: session.members,
  });
}
