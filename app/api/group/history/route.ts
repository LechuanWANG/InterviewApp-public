import { NextResponse } from "next/server";
import { getCurrentUserId, unauthorizedJson } from "@/lib/auth";
import { listGroupSessions } from "@/lib/groupInterview/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const ownerId = getCurrentUserId();
  if (!ownerId) return unauthorizedJson();

  try {
    const records = await listGroupSessions(ownerId);
    return NextResponse.json(
      { records },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("group history failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "server error" },
      { status: 500 }
    );
  }
}
