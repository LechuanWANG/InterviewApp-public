import { NextRequest, NextResponse } from "next/server";
import { getConsultSession, reopenConsultSession } from "@/lib/consultation/store";
import { getCurrentUserId, unauthorizedJson } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const ownerId = getCurrentUserId();
  if (!ownerId) return unauthorizedJson();
  const session = await getConsultSession(params.id, ownerId);
  if (!session) {
    return NextResponse.json({ error: "consult session not found" }, { status: 404 });
  }

  const reopened = await reopenConsultSession(params.id, ownerId);
  if (!reopened) {
    return NextResponse.json({ error: "恢复战略咨询失败" }, { status: 500 });
  }

  return NextResponse.json({
    consultId: reopened.id,
    status: reopened.status,
  });
}
