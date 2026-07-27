import { NextRequest, NextResponse } from "next/server";
import { saveConsultExperienceRating } from "@/lib/experienceFeedback";
import { getCurrentUserId, unauthorizedJson } from "@/lib/auth";
import { getConsultSession } from "@/lib/consultation/store";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const ownerId = getCurrentUserId();
    if (!ownerId) return unauthorizedJson();

    const body = (await req.json()) as {
      consultId?: string;
      rating?: number;
    };

    if (!body.consultId) {
      return NextResponse.json({ error: "consultId is required" }, { status: 400 });
    }

    const session = await getConsultSession(body.consultId, ownerId);
    if (!session) {
      return NextResponse.json({ error: "consult session not found" }, { status: 404 });
    }

    await saveConsultExperienceRating({
      targetId: body.consultId,
      rating: Number(body.rating),
      ownerId,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "保存咨询体验评分失败" },
      { status: 500 }
    );
  }
}
