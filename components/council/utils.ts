import type { UiLanguage } from "@/lib/i18n";
import type { InterviewPlanCouncil } from "@/lib/types";
import type {
  CouncilResult,
  CouncilTurn,
  ResolutionLogItem,
  ResolutionStatus,
  SpeakerState,
} from "./types";

export function defaultSpeakers(language: "zh" | "en", customRoles?: string[]): SpeakerState[] {
  const roles = customRoles?.length
    ? customRoles
    : language === "en"
      ? ["JD Analyst", "Resume Deep-Dive Expert", "Interview Strategy Designer", "Risk Challenger", "Host"]
      : ["JD 解构官", "简历深挖官", "面试策略官", "风险质疑官", "主持人"];
  return roles.map((role) => ({ role, status: "idle", count: 0 }));
}

export function localizedSpeakerRole(role: string, t: (key: string) => string): string {
  const normalized = role.toLowerCase().replace(/\s+/g, "");
  if (normalized.includes("jd解构官") || normalized.includes("jdanalyst")) return t("councilPage.role.jd");
  if (normalized.includes("简历深挖官") || normalized.includes("resume")) return t("councilPage.role.resume");
  if (normalized.includes("面试策略官") || normalized.includes("strategy")) return t("councilPage.role.strategy");
  if (normalized.includes("风险质疑官") || normalized.includes("riskchallenger") || normalized === "risk") return t("councilPage.role.risk");
  if (normalized.includes("主持人") || normalized === "host" || normalized.includes("consensushost")) return t("councilPage.role.host");
  return role;
}

export function isModeratorRole(role: string): boolean {
  const normalized = role.toLowerCase().replace(/\s+/g, "");
  return normalized.includes("主持人") || normalized === "host" || normalized.includes("consensushost");
}

export function isRiskRole(role: string): boolean {
  const normalized = role.toLowerCase().replace(/\s+/g, "");
  return normalized.includes("风险质疑官") || normalized.includes("riskchallenger");
}

export function markSpeaker(items: SpeakerState[], role: string, status: SpeakerState["status"], result?: CouncilResult): SpeakerState[] {
  const index = items.findIndex((item) => item.role === role || role.includes(item.role) || item.role.includes(role));
  const satisfaction = typeof result?.satisfaction === "number"
    ? Math.max(0, Math.min(100, Math.round(result.satisfaction)))
    : undefined;
  const satisfied = result?.satisfied === true || result?.approved === true;
  if (index < 0) {
    return [...items, {
      role,
      status,
      count: status === "done" ? 1 : 0,
      satisfaction,
      satisfied,
    }];
  }
  return items.map((item, itemIndex) => itemIndex === index
    ? {
        ...item,
        status,
        count: status === "done" ? item.count + 1 : item.count,
        satisfaction: satisfaction ?? item.satisfaction,
        satisfied: result ? satisfied : item.satisfied,
      }
    : item
  );
}

export function applyResolutionLog(items: SpeakerState[], log: ResolutionLogItem[]): SpeakerState[] {
  if (!log.length) return items;
  return items.map((speaker) => {
    const resolution = findResolutionForRole(log, speaker.role);
    if (!resolution || isModeratorRole(speaker.role) || !isRiskRole(speaker.role)) return speaker;
    return {
      ...speaker,
      status: "done",
      satisfied: true,
      finalStatus: resolution.status,
    };
  });
}

export function buildResolutionLog(council: InterviewPlanCouncil | undefined | null, turns: CouncilTurn[]): ResolutionLogItem[] {
  const explicitLog = council?.consensus.resolutionLog ?? [];
  if (explicitLog.length > 0) {
    return explicitLog.map((item) => ({
      expert: item.expert,
      concern: item.concern,
      action: item.action,
      status: item.status,
    }));
  }

  const expertRoles = council?.experts.map((expert) => expert.role).filter(Boolean) ?? [];
  return expertRoles.map((role) => {
    const review = [...turns].reverse().find((turn) =>
      sameRole(turn.role, role) && (turn.phase === "review" || turn.phase === "critique")
    );
    const approved = review?.result.approved === true || review?.result.satisfied === true;
    const concern = review?.result.remainingConcern || review?.result.conclusion || "";
    return {
      expert: role,
      concern,
      action: approved
        ? "已通过最终方案。"
        : "主持人已在最终主题路线图中合并处理该意见。",
      status: approved ? "approved" as const : "resolved" as const,
    };
  });
}

export function resolutionStatusLabel(status: ResolutionStatus, t: (key: string) => string): string {
  if (status === "approved") return t("councilPage.resolution.approved");
  if (status === "adjudicated") return t("councilPage.resolution.adjudicated");
  return t("councilPage.resolution.resolved");
}

export function resolutionBadgeClass(status: ResolutionStatus): string {
  if (status === "approved") return "bg-emerald-100 text-emerald-700";
  if (status === "adjudicated") return "bg-sky-100 text-sky-700";
  return "bg-teal-100 text-teal-700";
}

export function compactResult(result: CouncilResult | undefined): CouncilResult {
  if (!result) return {};
  return {
    conclusion: trimText(result.conclusion, 90),
    satisfaction: typeof result.satisfaction === "number"
      ? Math.max(0, Math.min(100, Math.round(result.satisfaction)))
      : undefined,
    satisfied: result.satisfied,
    approved: result.approved,
    remainingConcern: trimText(result.remainingConcern, 70),
    keyFindings: result.keyFindings?.slice(0, 2).map((item) => trimText(item, 60)),
    focusAreas: result.focusAreas?.slice(0, 2).map((item) => trimText(item, 30)),
    questionIdeas: result.questionIdeas?.slice(0, 2).map((item) => ({
      question: trimText(item.question, 80),
      purpose: trimText(item.purpose, 70),
    })),
    predictedRisks: result.predictedRisks?.slice(0, 2).map((item) => ({
      risk: trimText(item.risk, 60),
      whyItMatters: trimText(item.whyItMatters, 70),
    })),
    concerns: result.concerns?.slice(0, 2).map((item) => ({
      concern: trimText(item.concern, 70),
      resolutionHint: trimText(item.resolutionHint, 70),
    })),
    resolutionLog: result.resolutionLog?.slice(0, 4).map((item) => ({
      expert: trimText(item.expert, 30),
      concern: trimText(item.concern, 70),
      action: trimText(item.action, 90),
      status: item.status,
    })),
  };
}

export function phaseForEvent(type: string): CouncilTurn["phase"] {
  if (type.includes("skip")) return "skip";
  if (type.includes("review")) return "review";
  if (type.includes("critique")) return "critique";
  if (type.includes("revision")) return "revision";
  if (type.includes("consensus")) return "consensus";
  return "first";
}

export function phaseLabel(phase: CouncilTurn["phase"], t: (key: string) => string): string {
  if (phase === "critique") return t("councilPage.phase.critique");
  if (phase === "revision") return t("councilPage.phase.revision");
  if (phase === "skip") return t("councilPage.phase.skip");
  if (phase === "review") return t("councilPage.phase.review");
  if (phase === "consensus") return t("councilPage.phase.consensus");
  if (phase === "fallback") return t("councilPage.phase.fallback");
  return t("councilPage.phase.first");
}

export function firstMeaningfulLine(result: CouncilResult): string {
  return result.keyFindings?.[0] ||
    result.focusAreas?.[0] ||
    result.questionIdeas?.[0]?.question ||
    result.concerns?.[0]?.concern ||
    result.predictedRisks?.[0]?.risk ||
    "";
}

export function trimText(value: string | undefined, max: number): string {
  if (!value) return "";
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function transcriptKey(turn: CouncilTurn, index: number): string {
  return `${index}-${turn.role}-${turn.phase}-${turn.result.conclusion || firstMeaningfulLine(turn.result)}`;
}

export function transcriptOpacity(age: number): number {
  if (age <= 0) return 1;
  if (age === 1) return 0.82;
  if (age === 2) return 0.62;
  if (age === 3) return 0.42;
  return 0.24;
}

export function transcriptSlide(age: number): number {
  return Math.min(age * 10, 42);
}

export function transcriptScale(age: number): number {
  return Math.max(0.96, 1 - age * 0.01);
}

export function speakerPosition(index: number): { left: string; top: string; transform: string } {
  const positions = [
    { left: "50%", top: "0%", transform: "translate(-50%, 0)" },
    { left: "96%", top: "30%", transform: "translate(-100%, -50%)" },
    { left: "78%", top: "92%", transform: "translate(-50%, -100%)" },
    { left: "22%", top: "92%", transform: "translate(-50%, -100%)" },
    { left: "4%", top: "30%", transform: "translate(0, -50%)" },
  ];
  return positions[index % positions.length];
}

export function topicPillClass(priority: "high" | "medium" | "low"): string {
  if (priority === "high") return "bg-amber-100 text-amber-800";
  if (priority === "low") return "bg-sky-100 text-sky-700";
  return "bg-emerald-100 text-emerald-700";
}

export function sourceLabel(source: "jd" | "resume" | "risk" | "strategy", language: UiLanguage): string {
  if (language === "en") {
    if (source === "jd") return "From JD";
    if (source === "resume") return "From resume";
    if (source === "risk") return "From risk review";
    return "From interview strategy";
  }
  if (source === "jd") return "来自 JD";
  if (source === "resume") return "来自简历";
  if (source === "risk") return "来自风险关注";
  return "来自面试策略";
}

function findResolutionForRole(log: ResolutionLogItem[], role: string): ResolutionLogItem | undefined {
  return log.find((item) => sameRole(item.expert, role));
}

function sameRole(left: string, right: string): boolean {
  const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, "");
  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  return normalizedLeft === normalizedRight || normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft);
}
