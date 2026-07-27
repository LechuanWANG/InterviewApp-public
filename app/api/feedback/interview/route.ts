import { NextRequest, NextResponse } from "next/server";
import { saveInterviewExperienceRating } from "@/lib/experienceFeedback";
import { getCurrentUserId, unauthorizedJson } from "@/lib/auth";
import { getSession } from "@/lib/store";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const ownerId = getCurrentUserId();
    if (!ownerId) return unauthorizedJson();

    const body = (await req.json()) as {
      sessionId?: string;
      rating?: number;
    };

    if (!body.sessionId) {
      return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
    }

    const session = await getSession(body.sessionId, ownerId);
    if (!session) {
      return NextResponse.json({ error: "session not found" }, { status: 404 });
    }

    await saveInterviewExperienceRating({
      targetId: body.sessionId,
      rating: Number(body.rating),
      ownerId,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "保存面试体验评分失败" },
      { status: 500 }
    );
  }
}
