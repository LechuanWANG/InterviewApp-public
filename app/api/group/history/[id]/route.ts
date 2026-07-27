import { NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";
import { getCurrentUserId, unauthorizedJson } from "@/lib/auth";
import { getGroupSession, softDeleteGroupSession } from "@/lib/groupInterview/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
};

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  noStore();
  const ownerId = getCurrentUserId();
  if (!ownerId) return unauthorizedJson();

  const session = await getGroupSession(params.id, ownerId);
  if (!session) {
    return NextResponse.json(
      { ok: false, error: "群面记录不存在" },
      { status: 404, headers: NO_STORE_HEADERS }
    );
  }

  const ok = await softDeleteGroupSession(params.id, ownerId);
  if (!ok) {
    return NextResponse.json(
      { ok: false, error: "删除群面记录失败" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }

  return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
}
