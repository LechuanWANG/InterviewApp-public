import { NextRequest, NextResponse } from "next/server";
import { getSession, updateSession } from "@/lib/store";
import { getCurrentUserId, unauthorizedJson } from "@/lib/auth";
import type { Round } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const ownerId = getCurrentUserId();
    if (!ownerId) return unauthorizedJson();
    const session = await getSession(params.id, ownerId);
    if (!session) {
      return NextResponse.json({ error: "session not found" }, { status: 404 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      answer?: string;
      timedOut?: boolean;
    };

    const rounds: Round[] = [...session.rounds];
    if (session.currentQuestion) {
      rounds.push({
        question: session.currentQuestion,
        answer: body.answer?.trim() || (session.language === "en" ? "[No answer]" : "未作答"),
        isFollowUp: session.currentIsFollowUp,
        timedOut: body.timedOut,
      });
    }

    await updateSession(params.id, {
      rounds,
      currentQuestion: null,
      currentIsFollowUp: false,
      status: "finished",
    }, ownerId);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "结束面试失败" },
      { status: 500 }
    );
  }
}
