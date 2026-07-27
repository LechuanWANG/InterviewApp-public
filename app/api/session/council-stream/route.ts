import { NextRequest, NextResponse } from "next/server";
import { createSession, updateSession } from "@/lib/store";
import { generateInterviewPlanWithCouncilEvents } from "@/lib/prompts/generatePlan";
import { findModel, DEFAULT_MODEL_ID } from "@/lib/llm/models";
import { coercePersonaForInterviewType, findDifficulty, findPersona } from "@/lib/personas";
import { getCurrentUserId, unauthorizedJson } from "@/lib/auth";
import type { Difficulty, InterviewMode, InterviewType, Language, Persona } from "@/lib/types";

export const runtime = "nodejs";

type CouncilSessionBody = {
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
};

export async function POST(req: NextRequest) {
  const ownerId = getCurrentUserId();
  if (!ownerId) return unauthorizedJson();

  let body: CouncilSessionBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json body" }, { status: 400 });
  }

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
  } = body;

  if (!resume || !company || !jobTitle || !jd) {
    return NextResponse.json(
      { error: "resume, company, jobTitle, jd 为必填项" },
      { status: 400 }
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      function send(event: string, data: unknown) {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          closed = true;
        }
      }

      const heartbeat = setInterval(() => {
        send("heartbeat", { type: "heartbeat", ts: Date.now() });
      }, 10000);

      try {
        const m = findModel(modelId);
        const p = findPersona(coercePersonaForInterviewType(persona, interviewType));
        const d = findDifficulty(difficulty);

        send("session_preparing", {
          message: language === "zh"
            ? "正在创建面试上下文。"
            : "Preparing the interview context.",
        });

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

        const plan = await generateInterviewPlanWithCouncilEvents({
          resume,
          company,
          jobTitle,
          jd,
          interviewType,
          language,
          persona: p.id,
          difficulty: d.id,
          llm: { provider: m.provider, model: m.model, thinkingEnabled },
        }, (event) => {
          send(event.type, event);
        });

        const updated = await updateSession(session.id, {
          plan,
          currentQuestion: plan.openingQuestion,
          status: "in_progress",
        }, ownerId);

        if (!updated) {
          throw new Error("failed to save interview plan");
        }

        send("session_created", {
          sessionId: session.id,
          question: plan.openingQuestion,
          focusAreas: plan.focusAreas,
          council: plan.council ?? null,
        });
        send("done", { ok: true, sessionId: session.id });
      } catch (error) {
        console.error("council stream failed:", error);
        send("error", {
          type: "error",
          error: error instanceof Error ? error.message : "server error",
        });
      } finally {
        clearInterval(heartbeat);
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // Client may have disconnected after the last heartbeat or event.
          }
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
