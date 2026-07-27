import { NextRequest, NextResponse } from "next/server";
import { getInterviewRecords } from "@/lib/historyStore";
import { getGroupSession } from "@/lib/groupInterview/store";
import { groupSessionToConsultRecord } from "@/lib/consultation/groupRecordAdapter";
import { createConsultSession } from "@/lib/consultation/store";
import {
  buildConsultMemoryDigest,
  buildConsultMemorySnapshot,
  DEFAULT_CONSULT_PROFILE_ID,
} from "@/lib/consultation/memory";
import { generateConsultOpening } from "@/lib/prompts/consultation";
import type { ConsultGoal } from "@/lib/consultation/types";
import { DEFAULT_MODEL_ID, findModel } from "@/lib/llm/models";
import { getCurrentUserId, unauthorizedJson, userMemoryProfileId } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const ownerId = getCurrentUserId();
    if (!ownerId) return unauthorizedJson();

    const body = (await req.json()) as {
      selectedInterviewSessionIds?: string[];
      selectedGroupSessionIds?: string[];
      goal?: ConsultGoal;
      modelId?: string;
      memoryEnabled?: boolean;
    };
    const ids = Array.isArray(body.selectedInterviewSessionIds)
      ? body.selectedInterviewSessionIds.filter(Boolean)
      : [];
    const groupIds = Array.isArray(body.selectedGroupSessionIds)
      ? body.selectedGroupSessionIds.filter(Boolean)
      : [];

    // 自由聊天模式：允许不选任何记录直接开聊；选了则作为「焦点置顶」记录。
    const oneOnOneRecords = ids.length ? await getInterviewRecords(ids, ownerId) : [];
    const groupSessions = groupIds.length
      ? await Promise.all(groupIds.map((gid) => getGroupSession(gid, ownerId)))
      : [];
    const groupRecords = groupSessions
      .map((session) => (session ? groupSessionToConsultRecord(session) : null))
      .filter((record): record is NonNullable<typeof record> => record !== null);

    const records = [...oneOnOneRecords, ...groupRecords];

    const goal =
      body.goal || (records.length === 0 ? "open_chat" : records.length === 1 ? "single_review" : "common_issues");
    const model = findModel(body.modelId || DEFAULT_MODEL_ID);
    const memoryEnabled = body.memoryEnabled !== false;
    const memoryProfileId = userMemoryProfileId(ownerId) || DEFAULT_CONSULT_PROFILE_ID;
    const memoryDigest = memoryEnabled
      ? buildConsultMemoryDigest(
          await buildConsultMemorySnapshot({
            sessions: [],
            profileId: memoryProfileId,
            ownerId,
          })
        )
      : "用户本次未开启长期咨询记忆。不要引用过往战略咨询，只基于本次选择的面试记录和当前对话推进。";
    const firstMessage = await generateConsultOpening({
      records,
      goal,
      memoryDigest,
      llm: { provider: model.provider, model: model.model },
    });
    const session = await createConsultSession({
      ownerId,
      records,
      goal,
      firstMessage,
      memoryProfileId,
      memoryEnabled,
      provider: model.provider,
      model: model.model,
    });

    return NextResponse.json({
      consultId: session.id,
      firstMessage,
      summaryMode: session.summaryMode,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "创建战略咨询会话失败" },
      { status: 500 }
    );
  }
}
