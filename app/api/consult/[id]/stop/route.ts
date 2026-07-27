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
import { generateConsultSummary } from "@/lib/prompts/consultation";
import { getCurrentUserId, unauthorizedJson } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const ownerId = getCurrentUserId();
    if (!ownerId) return unauthorizedJson();
    const session = await getConsultSession(params.id, ownerId);
    if (!session) {
      return NextResponse.json({ error: "consult session not found" }, { status: 404 });
    }

    const latestUserMessage = [...session.messages].reverse().find((message) => message.role === "user")?.content;
    const memoryDigest = session.memoryEnabled
      ? buildConsultMemoryDigest(
          await buildConsultMemorySnapshot({
            sessions: [],
            currentSessionId: session.id,
            profileId: session.memoryProfileId,
            ownerId,
          }),
          { userMessage: latestUserMessage }
        )
      : "用户本次未开启长期咨询记忆。不要引用过往战略咨询，只基于本次选择的面试记录和当前对话推进。";
    const conversationCoverageDigest = buildConversationCoverageDigest(session.messages);
    const { summary, closingMessage } = await generateConsultSummary({
      records: session.records,
      goal: session.goal,
      messages: session.messages,
      memoryDigest,
      conversationCoverageDigest,
      llm: { provider: session.provider, model: session.model },
    });
    await appendConsultMessage(session.id, "assistant", closingMessage, ownerId);
    await completeConsultSession(session.id, summary, "user_click", ownerId);

    return NextResponse.json({
      message: closingMessage,
      summary,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "生成战略咨询结论失败" },
      { status: 500 }
    );
  }
}
