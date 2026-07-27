import { NextRequest, NextResponse } from "next/server";
import { createSession, updateSession } from "@/lib/store";
import { generateInterviewPlan, generateSingleInterviewPlan } from "@/lib/prompts/generatePlan";
import { findModel, DEFAULT_MODEL_ID } from "@/lib/llm/models";
import { coercePersonaForInterviewType, findDifficulty, findPersona } from "@/lib/personas";
import { getCurrentUserId, unauthorizedJson } from "@/lib/auth";
import type { InterviewType, Language, Persona, Difficulty, InterviewMode } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const ownerId = getCurrentUserId();
    if (!ownerId) return unauthorizedJson();

    const body = await req.json();
    const {
      resume,
      company,
      jobTitle,
      jd,
      interviewType = "mixed",
      language = "zh",
      modelId = DEFAULT_MODEL_ID,
      thinkingEnabled = false,
      persona = "pro_expert",
      difficulty = "medium",
      mode = "simulate",
      useCouncil = true,
    } = body as {
      resume: string;
      company: string;
      jobTitle: string;
      jd: string;
      interviewType?: InterviewType;
      language?: Language;
      modelId?: string;
      thinkingEnabled?: boolean;
      persona?: Persona;
      difficulty?: Difficulty;
      mode?: InterviewMode;
      useCouncil?: boolean;
    };

    if (!resume || !company || !jobTitle || !jd) {
      return NextResponse.json(
        { error: "resume, company, jobTitle, jd 为必填项" },
        { status: 400 }
      );
    }

    const m = findModel(modelId);
    const p = findPersona(coercePersonaForInterviewType(persona, interviewType));
    const d = findDifficulty(difficulty);

    const session = await createSession({
      ownerId,
      resume,
      company,
      jobTitle,
      jd,
      interviewType,
      language,
      persona: p.id,
      difficulty: d.id,
      mode,
      provider: m.provider,
      model: m.model,
      thinkingEnabled,
    });

    const planner = useCouncil ? generateInterviewPlan : generateSingleInterviewPlan;
    const plan = await planner({
      resume,
      company,
      jobTitle,
      jd,
      interviewType,
      language,
      persona: p.id,
      difficulty: d.id,
      llm: { provider: m.provider, model: m.model, thinkingEnabled },
    });

    await updateSession(session.id, {
      plan,
      currentQuestion: plan.openingQuestion,
      status: "in_progress",
    }, ownerId);

    return NextResponse.json({
      sessionId: session.id,
      question: plan.openingQuestion,
      focusAreas: plan.focusAreas,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "server error" },
      { status: 500 }
    );
  }
}
