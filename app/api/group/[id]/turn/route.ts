import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId, unauthorizedJson } from "@/lib/auth";
import { getGroupSession, updateGroupSession } from "@/lib/groupInterview/store";
import { runGroupTurn } from "@/lib/groupInterview/graph";
import type { GroupTurnResponse } from "@/lib/groupInterview/types";

export const runtime = "nodejs";

const TURN_TIMEOUT_MS = 25000;
// 安全上限：避免讨论无限循环(客户端正常情况下按倒计时结束)
const MAX_DISCUSSION_TURNS = 80;

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id } = params;
    const ownerId = getCurrentUserId();
    if (!ownerId) return unauthorizedJson();

    const session = await getGroupSession(id, ownerId);
    if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });

    if (session.phase !== "statements" && session.phase !== "discussion") {
      return NextResponse.json(
        { error: `turn not allowed in phase ${session.phase}` },
        { status: 400 }
      );
    }

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const remainingSec =
      typeof body.remainingSec === "number" ? body.remainingSec : session.durations.discussSec;
    const raiseHand = body.raiseHand === true;
    const skipUserPrompt = body.skipUserPrompt === true;

    if (session.phase === "discussion" && session.transcript.length >= MAX_DISCUSSION_TURNS) {
      await updateGroupSession(id, { phase: "electing" }, ownerId);
      return NextResponse.json<GroupTurnResponse>({ kind: "phase_done", nextPhase: "electing" });
    }

    const { decision, turn } = await withTimeout(
      runGroupTurn(session, {
        remainingSec,
        totalSec: session.durations.discussSec,
        userRaisedHand: raiseHand,
        skipUserPrompt,
      }),
      TURN_TIMEOUT_MS,
      "group turn timed out"
    );

    // 个人陈述全部完成 -> 进入自由讨论
    if (decision.wrapUp) {
      await updateGroupSession(id, { phase: "discussion" }, ownerId);
      return NextResponse.json<GroupTurnResponse>({ kind: "phase_done", nextPhase: "discussion" });
    }

    // AI 同学发言 -> 落库并返回
    if (turn) {
      const transcript = [...session.transcript, turn];
      await updateGroupSession(id, { transcript }, ownerId);
      return NextResponse.json<GroupTurnResponse>({
        kind: "turn",
        turn,
        promptUser: decision.shouldPromptUser,
      });
    }

    // 轮到用户发言
    return NextResponse.json<GroupTurnResponse>({
      kind: "your_turn",
      phase: session.phase,
      reason: decision.reason,
    });
  } catch (error) {
    console.error("group turn failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "server error" },
      { status: 500 }
    );
  }
}
