import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId, unauthorizedJson } from "@/lib/auth";
import { getGroupSession, updateGroupSession } from "@/lib/groupInterview/store";
import { generateAiReport } from "@/lib/groupInterview/prompts/reporter";
import type {
  GroupInterviewSession,
  GroupPhase,
  GroupTurn,
  ReporterKind,
} from "@/lib/groupInterview/types";

export const runtime = "nodejs";

const PHASES: GroupPhase[] = [
  "opening",
  "thinking",
  "statements",
  "discussion",
  "wrapup",
  "electing",
  "reporting",
  "finished",
];

// 合法的阶段跳转(对齐 GroupInterviewRoom 的编排顺序)
const ALLOWED_TRANSITIONS: Record<GroupPhase, GroupPhase[]> = {
  opening: ["thinking", "statements"],
  thinking: ["statements"],
  statements: ["discussion", "electing"],
  discussion: ["wrapup", "electing"],
  wrapup: ["electing"],
  electing: ["reporting"],
  reporting: ["finished"],
  finished: [],
};

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id } = params;
    const ownerId = getCurrentUserId();
    if (!ownerId) return unauthorizedJson();

    const session = await getGroupSession(id, ownerId);
    if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const to = body.to as GroupPhase;
    if (!PHASES.includes(to)) {
      return NextResponse.json({ error: `invalid phase ${to}` }, { status: 400 });
    }
    if (to !== session.phase && !ALLOWED_TRANSITIONS[session.phase]?.includes(to)) {
      return NextResponse.json(
        { error: `illegal transition ${session.phase} -> ${to}` },
        { status: 400 }
      );
    }

    const patch: Partial<GroupInterviewSession> = { phase: to };
    let extraTurn: GroupTurn | undefined;

    if (to === "reporting") {
      const reporterKind = (body.reporterKind as ReporterKind) ?? null;
      const reporterId = typeof body.reporterId === "string" ? body.reporterId : null;
      patch.reporterKind = reporterKind;
      patch.reporterId = reporterId;

      if (reporterKind === "ai") {
        const reporter =
          session.members.find((m) => m.id === reporterId && m.kind === "student") ??
          session.members.find((m) => m.kind === "student");
        if (reporter) {
          const text = await generateAiReport(session, reporter);
          extraTurn = {
            index: session.transcript.length,
            speakerId: reporter.id,
            speakerName: reporter.name,
            kind: "report",
            text,
            ts: Date.now(),
          };
          patch.transcript = [...session.transcript, extraTurn];
          patch.reporterId = reporter.id;
        }
      }
    }

    if (to === "finished") {
      patch.status = "finished";
    }

    const updated = await updateGroupSession(id, patch, ownerId);
    if (!updated) return NextResponse.json({ error: "failed to advance" }, { status: 500 });

    return NextResponse.json({ ok: true, turn: extraTurn ?? null });
  } catch (error) {
    console.error("group advance failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "server error" },
      { status: 500 }
    );
  }
}
