import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId, unauthorizedJson } from "@/lib/auth";
import { findModel, DEFAULT_MODEL_ID } from "@/lib/llm/models";
import { findDifficulty } from "@/lib/personas";
import type { VoiceSettings } from "@/lib/voice/types";
import type { Language } from "@/lib/types";
import { castGroupMembers } from "@/lib/groupInterview/groupPersonas";
import { generateGroupCouncilTopic } from "@/lib/groupInterview/council/generateGroupCouncilTopic";
import { buildHostOpening } from "@/lib/groupInterview/scripts";
import { createGroupSession } from "@/lib/groupInterview/store";
import { buildUserProfileText, safeText } from "@/lib/groupInterview/userProfile";
import {
  DEFAULT_GROUP_DURATIONS,
  type GroupInterviewSession,
  type GroupTurn,
} from "@/lib/groupInterview/types";

export const runtime = "nodejs";

type CouncilGroupBody = {
  resume?: string;
  participantNameplate?: string;
  participantName?: string;
  participantBackground?: string;
  company: string;
  jobTitle: string;
  jd: string;
  language?: Language;
  modelId?: string;
  difficulty?: string;
  autoPlay?: boolean;
  ttsEnabled?: boolean;
};

export async function POST(req: NextRequest) {
  const ownerId = getCurrentUserId();
  if (!ownerId) return unauthorizedJson();

  let body: CouncilGroupBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json body" }, { status: 400 });
  }

  const {
    resume,
    participantNameplate,
    participantName,
    participantBackground,
    company,
    jobTitle,
    jd,
    language = "zh",
    modelId = DEFAULT_MODEL_ID,
    difficulty = "medium",
    autoPlay = true,
    ttsEnabled = true,
  } = body;

  const companyText = safeText(company);
  const jobTitleText = safeText(jobTitle);
  const jdText = safeText(jd);
  const resumeText = safeText(resume);
  const userNameplate = safeText(participantNameplate || participantName);
  const userDisplayName = userNameplate || (language === "zh" ? "你" : "You");
  const backgroundText = safeText(participantBackground);
  const resumeForSession = buildUserProfileText({
    nameplate: userNameplate,
    name: safeText(participantName),
    background: backgroundText,
    resume: resumeText,
    language,
  });

  if (!resumeText || !companyText || !jobTitleText || !jdText || !userNameplate) {
    return NextResponse.json(
      { error: "resume, participantNameplate, company, jobTitle, jd 为必填项" },
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
        const d = findDifficulty(difficulty);
        const llm = { provider: m.provider, model: m.model, thinkingEnabled: false };

        send("session_preparing", {
          message: language === "zh"
            ? "正在创建群面上下文。"
            : "Preparing the group interview context.",
        });

        const members = castGroupMembers(language, {
          userName: userDisplayName,
          userBackground: backgroundText || resumeText.slice(0, 500),
        });

        // 群面专属命题合议：群面口径的专家流式评议，最终产出本场讨论题。
        const { topic, council, focusAreas } = await generateGroupCouncilTopic(
          {
            userProfile: resumeForSession,
            company: companyText,
            jobTitle: jobTitleText,
            jd: jdText,
            language,
            difficulty: d.id,
            llm,
          },
          (event) => send(event.type, event)
        );

        const voice: VoiceSettings = {
          asr: "doubao",
          tts: ttsEnabled === false ? "off" : "doubao",
          voice: "",
          autoPlay: autoPlay !== false,
        };

        const base: Omit<GroupInterviewSession, "id" | "createdAt"> = {
          ownerId,
          resume: resumeForSession,
          company: companyText,
          jobTitle: jobTitleText,
          jd: jdText,
          language,
          difficulty: d.id,
          durations: DEFAULT_GROUP_DURATIONS,
          provider: m.provider,
          model: m.model,
          thinkingEnabled: false,
          voice,
          topic,
          members,
          phase: "opening",
          transcript: [],
          reporterId: null,
          reporterKind: null,
          status: "in_progress",
          report: null,
        };

        const openingTurn: GroupTurn = {
          index: 0,
          speakerId: "host",
          speakerName: language === "zh" ? "HR" : "HR",
          kind: "host",
          text: buildHostOpening({ ...base, id: "", createdAt: 0 }),
          ts: Date.now(),
        };

        const session = await createGroupSession({
          ...base,
          transcript: [openingTurn],
        });

        send("session_created", {
          sessionId: session.id,
          council,
          focusAreas,
        });
        send("done", { ok: true, sessionId: session.id });
      } catch (error) {
        console.error("group council stream failed:", error);
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
