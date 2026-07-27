import type { ReactNode } from "react";
import type { UiLanguage } from "@/lib/i18n";
import type { InterviewPlanCouncil } from "@/lib/types";
import { useI18n } from "../LanguageProvider";
import type { CouncilTopic } from "./types";
import { sourceLabel, topicPillClass } from "./utils";

export function CouncilDesignBrief({
  council,
  topics,
  language,
}: {
  council: InterviewPlanCouncil | null;
  topics: CouncilTopic[];
  language: UiLanguage;
}) {
  const { t } = useI18n();
  const primaryTopics = topics.slice(0, 4);
  const firstRisk = council?.consensus.predictedRisks[0];
  const routeTopic = topics.find((topic) => topic.priority === "high") ?? topics[0];
  const candidateBrief = council?.consensus.candidateBrief;
  const focusSummary = attentionFocusText(routeTopic, firstRisk, language);

  return (
    <div className="overflow-hidden rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-sky-50 shadow-xl">
      <div className="border-b border-emerald-100 px-5 py-4">
        <div className="text-sm font-semibold text-emerald-950">{t("councilPage.readyTitle")}</div>
        <div className="mt-1 text-sm leading-6 text-emerald-800">{t("councilPage.readyDesc")}</div>
      </div>

      <div className="grid gap-3 p-5 sm:grid-cols-2">
        <DesignBriefCard title={t("councilPage.designThemes")}>
          <div className="flex flex-wrap gap-2">
            {primaryTopics.map((topic) => (
              <span
                key={topic.topic}
                className={`rounded-full px-3 py-1 text-[11px] font-medium ${topicPillClass(topic.priority)}`}
              >
                {topic.topic}
              </span>
            ))}
          </div>
          {primaryTopics[0]?.source?.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {primaryTopics[0].source.map((source) => (
                <span key={source} className="rounded-full bg-white/80 px-2 py-1 text-[10px] text-slate-500">
                  {sourceLabel(source, language)}
                </span>
              ))}
            </div>
          )}
        </DesignBriefCard>

        <DesignBriefCard title={t("councilPage.riskFocus")}>
          <div className="text-sm font-medium leading-6 text-slate-800">
            {focusSummary}
          </div>
        </DesignBriefCard>

        <DesignBriefCard title={t("councilPage.interviewRhythm")}>
          <div className="text-sm leading-6 text-slate-700">
            {candidateBrief?.interviewRhythm || interviewRhythmText(routeTopic, language)}
          </div>
        </DesignBriefCard>

        <DesignBriefCard title={t("councilPage.answerAdvice")}>
          <div className="text-sm leading-6 text-slate-700">
            {candidateBrief?.answerAdvice || answerAdviceText(language)}
          </div>
        </DesignBriefCard>
      </div>
    </div>
  );
}

function DesignBriefCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/80 bg-white/75 p-4 shadow-sm backdrop-blur">
      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{title}</div>
      {children}
    </div>
  );
}

function attentionFocusText(
  topic: CouncilTopic | undefined,
  risk: InterviewPlanCouncil["consensus"]["predictedRisks"][number] | undefined,
  language: UiLanguage
): string {
  const topicName = topic?.topic;
  const source = topic?.source?.[0];
  if (language === "en") {
    if (topicName) {
      return `The interviewer will pay closer attention to ${topicName}, especially whether your examples, ownership, and impact are clear.`;
    }
    return "The interviewer will pay closer attention to whether your examples, ownership, and impact are clear.";
  }
  if (topicName) {
    const sourceHint = source ? `，这一方向主要${sourceLabel(source, language)}` : "";
    return `面试官会更关注「${topicName}」${sourceHint}，重点看你的经历证据、个人贡献和业务结果是否讲清楚。`;
  }
  if (risk?.whyItMatters) {
    return "面试官会围绕经历证据、个人贡献和业务价值做进一步观察，不会提前透露具体题目。";
  }
  return "面试官会重点观察你的经历证据、个人贡献和业务价值是否清楚。";
}

function interviewRhythmText(topic: CouncilTopic | undefined, language: UiLanguage): string {
  const topicName = topic?.topic;
  if (language === "en") {
    return topicName
      ? `The interview will start broad, then decide whether to follow up or move to ${topicName} based on your answer.`
      : "The interview will start broad, then adaptively follow up or move to the next theme based on your answer.";
  }
  return topicName
    ? `先从整体匹配进入，再根据你的回答决定继续追问，或切换到「${topicName}」等重点主题。`
    : "先从整体匹配进入，再根据你的回答决定继续追问或切换到下一个主题。";
}

function answerAdviceText(language: UiLanguage): string {
  return language === "en"
    ? "Use real examples, clarify your actions and judgment, and connect results to measurable business impact."
    : "尽量用真实经历回答，说明你的具体动作、判断依据和可量化结果；不确定的地方可以坦诚说明。";
}
