import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId, unauthorizedJson } from "@/lib/auth";
import { findModel, DEFAULT_MODEL_ID } from "@/lib/llm/models";
import { findDifficulty } from "@/lib/personas";
import type { VoiceSettings } from "@/lib/voice/types";
import type { Language } from "@/lib/types";
import { castGroupMembers } from "@/lib/groupInterview/groupPersonas";
import { generateGroupTopic } from "@/lib/groupInterview/prompts/topic";
import { buildHostOpening } from "@/lib/groupInterview/scripts";
import { createGroupSession } from "@/lib/groupInterview/store";
import { buildUserProfileText, safeText } from "@/lib/groupInterview/userProfile";
import {
  DEFAULT_GROUP_DURATIONS,
  type GroupInterviewSession,
  type GroupTurn,
} from "@/lib/groupInterview/types";

export const runtime = "nodejs";

type CreateBody = {
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

  let body: CreateBody;
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

  try {
    const m = findModel(modelId);
    const d = findDifficulty(difficulty);
    const members = castGroupMembers(language, {
      userName: userDisplayName,
      userBackground: backgroundText || resumeText.slice(0, 500),
    });
    const voice: VoiceSettings = {
      asr: "doubao",
      tts: ttsEnabled === false ? "off" : "doubao",
      voice: "",
      autoPlay: autoPlay !== false,
    };

    const topic = await generateGroupTopic({
      userProfile: resumeForSession,
      company: companyText,
      jobTitle: jobTitleText,
      jd: jdText,
      language,
      difficulty: d.id,
      llm: { provider: m.provider, model: m.model, thinkingEnabled: false },
    });

    // 构造会话(不含开场白)，再用它生成 HR 开场白，最后写入 transcript[0]
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

    return NextResponse.json({ sessionId: session.id });
  } catch (error) {
    console.error("group session create failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "server error" },
      { status: 500 }
    );
  }
}
