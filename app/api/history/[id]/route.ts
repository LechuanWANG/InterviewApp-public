import { NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";
import { deleteInterviewRecord, getInterviewRecordById } from "@/lib/historyStore";
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
  _req: Request,
  { params }: { params: { id: string } }
) {
  noStore();
  const ownerId = getCurrentUserId();
  if (!ownerId) return unauthorizedJson();
  const record = await getInterviewRecordById(params.id, ownerId);
  if (!record) {
    return NextResponse.json({ error: "历史面试记录不存在" }, { status: 404, headers: NO_STORE_HEADERS });
  }

  return NextResponse.json({ record }, { headers: NO_STORE_HEADERS });
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } }
) {
  noStore();
  const ownerId = getCurrentUserId();
  if (!ownerId) return unauthorizedJson();
  const url = new URL(req.url);
  const result = await deleteInterviewRecord(params.id, url.searchParams.get("sessionId") || undefined, ownerId);
  if (!result.ok) {
    return NextResponse.json(
      {
        ...result,
        error: `删除后仍存在 ${result.remaining} 条历史面试记录、${result.remainingSessions} 条面试会话`,
      },
      { status: 409, headers: NO_STORE_HEADERS }
    );
  }
  return NextResponse.json(result, { headers: NO_STORE_HEADERS });
}
