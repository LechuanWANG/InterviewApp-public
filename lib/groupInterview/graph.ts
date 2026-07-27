import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { decideNextSpeaker, type DirectorContext } from "./director";
import { generateStudentSpeech } from "./prompts/student";
import type { DirectorDecision, GroupInterviewSession, GroupTurn, GroupTurnKind } from "./types";

// ============================================================
// 智能群面讨论循环：LangGraph 单遍图(每个发言位 invoke 一次)
// director(决定下一棒) -> [user 让位 END] / [student 生成发言 -> END]
// 「循环到倒计时结束」「等用户发言」由外层 SSE 编排 + DB 持久化控制(见 plan 5.5)。
// ============================================================

const GroupTurnGraphState = Annotation.Root({
  session: Annotation<GroupInterviewSession>,
  ctx: Annotation<DirectorContext>,
  decision: Annotation<DirectorDecision | undefined>({
    reducer: (_l, r) => r,
    default: () => undefined,
  }),
  turn: Annotation<GroupTurn | undefined>({
    reducer: (_l, r) => r,
    default: () => undefined,
  }),
});

type State = typeof GroupTurnGraphState.State;

async function directNode(state: State): Promise<Partial<State>> {
  const decision = await decideNextSpeaker(state.session, state.ctx);
  return { decision };
}

async function speakNode(state: State): Promise<Partial<State>> {
  const session = state.session;
  const decision = state.decision!;
  const member = session.members.find((m) => m.id === decision.nextSpeaker);
  if (!member || member.kind !== "student") {
    return {};
  }
  const speech = await generateStudentSpeech({ session, member, decision });
  const kind: GroupTurnKind = session.phase === "statements" ? "statement" : "speech";
  const turn: GroupTurn = {
    index: session.transcript.length,
    speakerId: member.id,
    speakerName: member.name,
    kind,
    intent: decision.intent,
    referTo: speech.referTo,
    text: speech.text,
    ts: Date.now(),
  };
  return { turn };
}

function routeAfterDirect(state: State): "speak" | typeof END {
  const decision = state.decision;
  if (!decision || decision.wrapUp) return END;
  if (decision.nextSpeaker === "user" || !decision.nextSpeaker) return END;
  const member = state.session.members.find((m) => m.id === decision.nextSpeaker);
  return member?.kind === "student" ? "speak" : END;
}

const groupTurnGraph = new StateGraph(GroupTurnGraphState)
  .addNode("direct", directNode)
  .addNode("speak", speakNode)
  .addEdge(START, "direct")
  .addConditionalEdges("direct", routeAfterDirect, { speak: "speak", [END]: END })
  .addEdge("speak", END)
  .compile();

export type GroupTurnResult = {
  decision: DirectorDecision;
  turn?: GroupTurn;
};

/**
 * 跑一个发言位：返回调度决策，以及(若该棒是 AI 同学)生成的发言。
 * - decision.wrapUp === true：当前阶段结束，应推进到下一阶段。
 * - decision.nextSpeaker === "user"：让位用户，外层应发 your_turn 并等待用户提交。
 * - 否则 turn 为 AI 同学的发言，外层应追加到 transcript 并推送。
 */
export async function runGroupTurn(
  session: GroupInterviewSession,
  ctx: DirectorContext
): Promise<GroupTurnResult> {
  const result = await groupTurnGraph.invoke({ session, ctx });
  const decision =
    result.decision ?? {
      nextSpeaker: "",
      intent: "summarize" as const,
      referToSpeakers: [],
      reason: "调度失败，结束本阶段。",
      shouldPromptUser: false,
      wrapUp: true,
    };
  return { decision, turn: result.turn };
}
