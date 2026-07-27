import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId, unauthorizedJson } from "@/lib/auth";
import { getGroupSession, updateGroupSession } from "@/lib/groupInterview/store";
import type { GroupTurn, GroupTurnKind } from "@/lib/groupInterview/types";

export const runtime = "nodejs";

const ALLOWED_KINDS: GroupTurnKind[] = ["statement", "speech", "report"];

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id } = params;
    const ownerId = getCurrentUserId();
    if (!ownerId) return unauthorizedJson();

    const session = await getGroupSession(id, ownerId);
    if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const text = typeof body.text === "string" ? body.text.trim() : "";
    const kind = (typeof body.kind === "string" ? body.kind : "speech") as GroupTurnKind;

    if (!text) return NextResponse.json({ error: "empty text" }, { status: 400 });
    if (!ALLOWED_KINDS.includes(kind)) {
      return NextResponse.json({ error: `invalid kind ${kind}` }, { status: 400 });
    }

    const userMember = session.members.find((m) => m.kind === "user");
    const turn: GroupTurn = {
      index: session.transcript.length,
      speakerId: "user",
      speakerName: userMember?.name ?? (session.language === "zh" ? "你" : "You"),
      kind,
      text,
      ts: Date.now(),
    };

    const transcript = [...session.transcript, turn];
    const updated = await updateGroupSession(id, { transcript }, ownerId);
    if (!updated) return NextResponse.json({ error: "failed to save turn" }, { status: 500 });

    return NextResponse.json({ ok: true, turn });
  } catch (error) {
    console.error("group speak failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "server error" },
      { status: 500 }
    );
  }
}
