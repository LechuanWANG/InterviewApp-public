import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/store";
import { getCurrentUserId, unauthorizedJson } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;
  const ownerId = getCurrentUserId();
  if (!ownerId) return unauthorizedJson();
  const s = await getSession(id, ownerId);
  if (!s) return NextResponse.json({ error: "session not found" }, { status: 404 });
  return NextResponse.json({
    id: s.id,
    company: s.company,
    jobTitle: s.jobTitle,
    currentQuestion: s.currentQuestion,
    focusAreas: s.plan?.focusAreas ?? [],
    rounds: s.rounds,
    status: s.status,
    hasReport: !!s.report,
  });
}
