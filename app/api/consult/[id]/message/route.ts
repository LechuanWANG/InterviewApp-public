import { NextRequest, NextResponse } from "next/server";
import {
  appendConsultMessage,
  completeConsultSession,
  getConsultSession,
} from "@/lib/consultation/store";
import {
  buildConsultMemoryDigest,
  buildConsultMemorySnapshot,
  buildConversationCoverageDigest,
} from "@/lib/consultation/memory";
import {
  generateConsultReply,
  generateConsultSummary,
  isConsultStopIntent,
} from "@/lib/prompts/consultation";
import {
  fetchConsultRecordsOnDemand,
  shouldRetrieveRecords,
} from "@/lib/consultation/recordFetch";
import { getCurrentUserId, unauthorizedJson } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const ownerId = getCurrentUserId();
    if (!ownerId) return unauthorizedJson();
    const session = await getConsultSession(params.id, ownerId);
    if (!session) {
      return NextResponse.json({ error: "consult session not found" }, { status: 404 });
    }
    if (session.status === "completed") {
      return NextResponse.json({ error: "consult session already completed" }, { status: 409 });
    }
    const body = (await req.json()) as { content?: string };
    const content = body.content?.trim();
    if (!content) {
      return NextResponse.json({ error: "content required" }, { status: 400 });
    }

    await appendConsultMessage(session.id, "user", content, ownerId);
    const memoryDigest = session.memoryEnabled
      ? buildConsultMemoryDigest(
          await buildConsultMemorySnapshot({
            sessions: [],
            currentSessionId: session.id,
            profileId: session.memoryProfileId,
            ownerId,
          }),
          { userMessage: content }
        )
      : "用户本次未开启长期咨询记忆。不要引用过往战略咨询，只基于本次选择的面试记录和当前对话推进。";
    const conversationCoverageDigest = buildConversationCoverageDigest(session.messages);

    if (isConsultStopIntent(content)) {
      const { summary, closingMessage } = await generateConsultSummary({
        records: session.records,
        goal: session.goal,
        messages: [...session.messages],
        memoryDigest,
        conversationCoverageDigest,
        llm: { provider: session.provider, model: session.model },
      });
      await appendConsultMessage(session.id, "assistant", closingMessage, ownerId);
      await completeConsultSession(session.id, summary, "user_voice", ownerId);
      return NextResponse.json({
        done: true,
        message: closingMessage,
        summary,
      });
    }

    // 记录注入策略：
    // - 若用户在选择页明确挑选了场次（session.records 非空），则每轮都把这些场次的详细信息给顾问（沿用旧逻辑）。
    // - 否则为自由聊天：仅当用户明显想基于面试记录复盘/找共性/取证时，才按需调取最近的面试记录。
    const llm = { provider: session.provider, model: session.model };
    const recordsForTurn = session.records.length
      ? await fetchConsultRecordsOnDemand({ ownerId, pinned: session.records })
      : (await shouldRetrieveRecords(content, llm))
        ? await fetchConsultRecordsOnDemand({ ownerId })
        : [];

    const reply = await generateConsultReply({
      records: recordsForTurn,
      goal: session.goal,
      messages: [...session.messages],
      userMessage: content,
      memoryDigest,
      conversationCoverageDigest,
      llm,
    });
    await appendConsultMessage(session.id, "assistant", reply, ownerId);
    return NextResponse.json({ done: false, message: reply });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "发送消息失败" },
      { status: 500 }
    );
  }
}
