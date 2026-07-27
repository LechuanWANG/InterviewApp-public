import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/store";
import { ensureSessionReport } from "@/lib/interview/reportService";
import { getCurrentUserId, unauthorizedJson } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const ownerId = getCurrentUserId();
    if (!ownerId) return unauthorizedJson();
    const session = await getSession(id, ownerId);
    if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });

    const nextSession = await ensureSessionReport(session);
    return NextResponse.json({ report: nextSession.report });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "server error" },
      { status: 500 }
    );
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;
  const ownerId = getCurrentUserId();
  if (!ownerId) return unauthorizedJson();
  const session = await getSession(id, ownerId);
  if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });
  return NextResponse.json({
    report: session.report,
    rounds: session.rounds,
    company: session.company,
    jobTitle: session.jobTitle,
  });
}
