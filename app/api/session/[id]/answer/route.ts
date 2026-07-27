import { NextRequest, NextResponse } from "next/server";
import { getSession, updateSession } from "@/lib/store";
import { decideNextQuestion } from "@/lib/prompts/nextQuestion";
import { getMaxInterviewRounds } from "@/lib/personas";
import {
  closingMessageForLanguage,
  isClosingInterviewPrompt,
} from "@/lib/interview/endDetection";
import { fallbackInterviewNextAction } from "@/lib/interview/langgraphAgent";
import { detectCandidateStopIntentWithLLM } from "@/lib/interview/stopIntent";
import { getCurrentUserId, unauthorizedJson } from "@/lib/auth";
import type { NextAction, Round, Session } from "@/lib/types";

export const runtime = "nodejs";

const STOP_INTENT_TIMEOUT_MS = 6000;
const NEXT_QUESTION_TIMEOUT_MS = 25000;

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const ownerId = getCurrentUserId();
    if (!ownerId) return unauthorizedJson();

    const { id } = params;
    const { answer, timedOut = false, question: answeredQuestion } = (await req.json()) as {
      answer: string;
      timedOut?: boolean;
      question?: string;
    };
    const session = await getSession(id, ownerId);
    if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });
    if (!session.currentQuestion) return NextResponse.json({ error: "no current question" }, { status: 400 });
    if (typeof answer !== "string") {
      return NextResponse.json({ error: "answer required" }, { status: 400 });
    }
    if (
      typeof answeredQuestion === "string" &&
      answeredQuestion.trim() &&
      answeredQuestion.trim() !== session.currentQuestion
    ) {
      return NextResponse.json(
        { error: "question changed, please refresh the interview state" },
        { status: 409 }
      );
    }

    const newRound: Round = {
      question: session.currentQuestion,
      answer: answer.trim(),
      isFollowUp: session.currentIsFollowUp,
      timedOut,
    };
    const duplicateLatestRound = isDuplicateLatestRound(
      session.rounds[session.rounds.length - 1],
      newRound
    );
    const rounds = duplicateLatestRound ? session.rounds : [...session.rounds, newRound];
    const savedSession = duplicateLatestRound
      ? session
      : await updateSession(id, { rounds }, ownerId);
    if (!savedSession) {
      throw new Error("failed to save answer");
    }
    const sessionWithAnswer: Session = { ...savedSession, rounds };

    const stopIntent = await detectStopIntentSafely(sessionWithAnswer, newRound.answer);
    if (stopIntent.shouldEnd) {
      await updateSession(
        id,
        { rounds, currentQuestion: null, currentIsFollowUp: false, status: "finished" },
        ownerId
      );
      return NextResponse.json({
        action: "end",
        question: closingMessageForLanguage(session.language),
        done: true,
        stopIntent,
      });
    }

    if (rounds.length >= getMaxInterviewRounds(session.difficulty)) {
      await updateSession(id, { rounds, currentQuestion: null, currentIsFollowUp: false, status: "finished" }, ownerId);
      return NextResponse.json({ action: "end", question: "", done: true });
    }

    const { decision, usedFallback } = await decideNextQuestionSafely(sessionWithAnswer);

    if (decision.action === "end" || isClosingInterviewPrompt(decision.question)) {
      await updateSession(id, { rounds, currentQuestion: null, currentIsFollowUp: false, status: "finished" }, ownerId);
      return NextResponse.json({ action: "end", question: decision.question, done: true });
    }

    await updateSession(id, {
      rounds,
      currentQuestion: decision.question,
      currentIsFollowUp: decision.action === "followup",
    }, ownerId);

    return NextResponse.json({
      action: decision.action,
      question: decision.question,
      done: false,
      round: rounds.length,
      fallback: usedFallback,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "server error" },
      { status: 500 }
    );
  }
}

async function detectStopIntentSafely(
  session: Session,
  answer: string
): Promise<Awaited<ReturnType<typeof detectCandidateStopIntentWithLLM>>> {
  try {
    return await withTimeout(
      detectCandidateStopIntentWithLLM({ session, answer }),
      STOP_INTENT_TIMEOUT_MS,
      "candidate stop intent detection timed out"
    );
  } catch (error) {
    console.warn("candidate stop intent detection unavailable, continuing interview", error);
    return {
      shouldEnd: false,
      confidence: 0,
      reason: "intent detection unavailable",
    };
  }
}

async function decideNextQuestionSafely(
  session: Session
): Promise<{ decision: NextAction; usedFallback: boolean }> {
  try {
    const decision = await withTimeout(
      decideNextQuestion(session),
      NEXT_QUESTION_TIMEOUT_MS,
      "next question generation timed out"
    );
    return { decision, usedFallback: false };
  } catch (error) {
    console.error("next question generation failed, using fallback", error);
    return {
      decision: fallbackInterviewNextAction(
        session,
        session.language === "zh"
          ? "下一题生成节点不可用，已使用本地兜底问题继续。"
          : "Next-question generation was unavailable, so a local fallback question was used."
      ),
      usedFallback: true,
    };
  }
}

function isDuplicateLatestRound(previous: Round | undefined, next: Round): boolean {
  return Boolean(
    previous &&
      previous.question === next.question &&
      previous.answer === next.answer &&
      previous.isFollowUp === next.isFollowUp &&
      previous.timedOut === next.timedOut
  );
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
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
