import type { Language } from "@/lib/types";
import type { GroupInterviewSession, GroupMember, GroupTurn } from "../types";

export function languageLabel(language: Language): string {
  return language === "zh" ? "中文" : "English";
}

export function compactText(value: string, maxLength: number): string {
  const normalized = (value || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function memberName(session: GroupInterviewSession, id: string): string {
  if (id === "host") return session.language === "zh" ? "HR" : "HR";
  return session.members.find((m) => m.id === id)?.name ?? id;
}

// 面向 prompt 的成员名册(含人格与背景，便于 director 与学生发言保持一致)
export function rosterForPrompt(session: GroupInterviewSession): string {
  return session.members
    .map((m) => {
      const role = m.kind === "user" ? "用户本人" : "AI 同学";
      const persona = m.persona ? `，人格：${m.persona}` : "";
      const bg = m.background ? `，背景：${m.background}` : "";
      return `- ${m.id}（${m.name}，${role}${persona}${bg}）`;
    })
    .join("\n");
}

// 最近 N 条发言的可读转写
export function recentTranscriptForPrompt(
  session: GroupInterviewSession,
  maxTurns = 12
): string {
  const turns = session.transcript.slice(-maxTurns);
  if (!turns.length) return "（暂无发言）";
  return turns
    .map((t) => `[${t.index}] ${labelOf(session, t)}：${compactText(t.text, 220)}`)
    .join("\n");
}

function labelOf(session: GroupInterviewSession, turn: GroupTurn): string {
  const name = memberName(session, turn.speakerId);
  if (turn.kind === "host") return `HR(${name})`;
  if (turn.kind === "statement") return `${name}·陈述`;
  if (turn.kind === "report") return `${name}·汇报`;
  return name;
}

export function speakCounts(session: GroupInterviewSession): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const m of session.members) counts[m.id] = 0;
  for (const t of session.transcript) {
    if (t.kind === "speech" && counts[t.speakerId] !== undefined) {
      counts[t.speakerId] += 1;
    }
  }
  return counts;
}

export function topicForPrompt(session: GroupInterviewSession): string {
  const t = session.topic;
  return `【讨论题】${t.title}
【背景材料】${t.background}
【岗位】${session.company} · ${session.jobTitle}`;
}

export function llmConfigOf(session: GroupInterviewSession) {
  return {
    provider: session.provider,
    model: session.model,
    thinkingEnabled: session.thinkingEnabled,
  };
}

export function describeMember(member: GroupMember): string {
  const persona = member.persona ? `人格：${member.persona}` : "";
  const bg = member.background ? `背景：${member.background}` : "";
  return [member.name, persona, bg].filter(Boolean).join("，");
}
