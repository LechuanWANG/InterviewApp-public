import type { RefObject } from "react";
import type { UiLanguage } from "@/lib/i18n";
import { useI18n } from "../LanguageProvider";
import type { MeetingNote, TranscriptItem } from "./types";
import {
  firstMeaningfulLine,
  isModeratorRole,
  isRiskRole,
  localizedSpeakerRole,
  phaseLabel,
  resolutionBadgeClass,
  resolutionStatusLabel,
  transcriptOpacity,
  transcriptScale,
  transcriptSlide,
} from "./utils";

const TRANSCRIPT_VISIBLE_TURNS = 4;

export function CouncilTranscriptPanel({
  turnsLength,
  transcriptItems,
  activeTranscriptKeys,
  meetingNotes,
  messages,
  transcriptRef,
  uiLanguage,
}: {
  turnsLength: number;
  transcriptItems: TranscriptItem[];
  activeTranscriptKeys: string[];
  meetingNotes: MeetingNote[];
  messages: string[];
  transcriptRef: RefObject<HTMLDivElement>;
  uiLanguage: UiLanguage;
}) {
  const { t } = useI18n();

  return (
    <div className="rounded-3xl border border-white/70 bg-white/80 p-5 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <div className="text-sm font-semibold text-slate-900">{t("councilPage.briefTranscript")}</div>
        <div className="text-xs text-slate-500">
          {turnCountLabel(turnsLength, uiLanguage, t)}
        </div>
      </div>
      <div ref={transcriptRef} className="mt-4 max-h-[25rem] space-y-3 overflow-y-auto pr-1">
        {turnsLength === 0 && meetingNotes.length === 0 && (
          <div className="rounded-2xl border border-dashed border-amber-200 bg-amber-50/40 p-4 text-sm text-slate-500">
            {messages[messages.length - 1] || ""}
          </div>
        )}
        {meetingNotes.map((note) => (
          <div
            key={note.key}
            className={`overflow-hidden rounded-2xl border bg-gradient-to-br from-amber-50/80 to-white shadow-sm transition-all duration-500 ease-out ${
              note.exiting ? "border-transparent" : "border-amber-100"
            }`}
            style={{
              opacity: note.exiting ? 0 : 1,
              transform: note.exiting ? "translateX(-120px) scale(0.94)" : "translateX(0) scale(1)",
              maxHeight: note.exiting ? 0 : 220,
              padding: note.exiting ? "0 0.75rem" : "0.75rem",
            }}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-semibold text-amber-900">
                {note.role ? localizedSpeakerRole(note.role, t) : t("councilPage.roundTable")}
              </div>
              <div className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-700">
                {meetingNoteStageLabel(note.stage, uiLanguage)}
              </div>
            </div>
            <div className="mt-1 text-sm leading-6 text-slate-700">{note.message}</div>
          </div>
        ))}
        {transcriptItems.map((item) => {
          const { turn } = item;
          const activeIndex = activeTranscriptKeys.indexOf(item.key);
          const age = item.exiting || activeIndex < 0
            ? TRANSCRIPT_VISIBLE_TURNS + 1
            : activeTranscriptKeys.length - activeIndex - 1;
          return (
            <div
              key={item.key}
              className={`overflow-hidden rounded-2xl border bg-gradient-to-br from-white to-slate-50 transition-all duration-500 ease-out ${
                item.exiting ? "border-transparent" : "border-slate-100"
              }`}
              style={{
                opacity: item.exiting ? 0 : transcriptOpacity(age),
                transform: item.exiting
                  ? "translateX(-120px) scale(0.94)"
                  : `translateX(-${transcriptSlide(age)}px) scale(${transcriptScale(age)})`,
                maxHeight: item.exiting ? 0 : 420,
                padding: item.exiting ? "0 0.75rem" : "0.75rem",
              }}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-semibold text-slate-900">{localizedSpeakerRole(turn.role, t)}</div>
                <div className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">
                  {phaseLabel(turn.phase, t)}
                </div>
              </div>
              <div className="mt-1 text-sm leading-6 text-slate-700">
                {turn.result.conclusion || firstMeaningfulLine(turn.result)}
              </div>
              {typeof turn.result.satisfaction === "number" && !isModeratorRole(turn.role) && (
                <div className="mt-2">
                  {isRiskRole(turn.role) ? (
                    typeof turn.result.approved === "boolean" ? (
                      <span className={`rounded-full px-2 py-1 text-[10px] font-medium ${
                        turn.result.satisfied || turn.result.approved
                          ? resolutionBadgeClass("approved")
                          : "bg-amber-100 text-amber-700"
                      }`}>
                        {turn.result.satisfied || turn.result.approved
                          ? resolutionStatusLabel("approved", t)
                          : t("councilPage.status.pendingRevision")}
                      </span>
                    ) : (
                      <span className="rounded-full bg-sky-100 px-2 py-1 text-[10px] font-medium text-sky-700">
                        {t("councilPage.status.riskCaptured")}
                      </span>
                    )
                  ) : (
                    <span className="rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-medium text-emerald-700">
                      {t("councilPage.status.inputCaptured")}
                    </span>
                  )}
                </div>
              )}
              {turn.result.resolutionLog && turn.result.resolutionLog.length > 0 && (
                <div className="mt-3 space-y-2">
                  {turn.result.resolutionLog
                    .slice()
                    .sort((left, right) => Number(isRiskRole(right.expert)) - Number(isRiskRole(left.expert)))
                    .slice(0, 4)
                    .map((item) => (
                    <div key={`${item.expert}-${item.action}`} className="rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                      <span className="font-semibold">{localizedSpeakerRole(item.expert, t)}</span>
                      <span className="mx-1 text-emerald-500">·</span>
                      <span>{resolutionStatusLabel(item.status, t)}</span>
                      {item.concern && item.concern !== item.action && (
                        <div className="mt-1 text-emerald-950/70">
                          {t("councilPage.focusPrefix")}{item.concern}
                        </div>
                      )}
                      <div className="mt-1 text-emerald-800">{item.action}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function meetingNoteStageLabel(stage: MeetingNote["stage"], language: UiLanguage): string {
  if (language === "en") {
    if (stage === "expert_result_ready") return "Input logged";
    if (stage === "risk_result_ready") return "Risk notes";
    if (stage === "draft_ready") return "Draft logged";
    if (stage === "risk_approved") return "Gate passed";
    if (stage === "risk_blocked") return "Revision needed";
    if (stage === "revision_ready") return "Revision logged";
    if (stage === "quality_fixed") return "Quality fixed";
    return "Meeting note";
  }
  if (stage === "expert_result_ready") return "观点记录";
  if (stage === "risk_result_ready") return "风险纪要";
  if (stage === "draft_ready") return "草案纪要";
  if (stage === "risk_approved") return "把关通过";
  if (stage === "risk_blocked") return "需要修订";
  if (stage === "revision_ready") return "修订纪要";
  if (stage === "quality_fixed") return "质检修复";
  return "会议纪要";
}

function turnCountLabel(
  count: number,
  language: UiLanguage,
  t: (key: string, values?: Record<string, string | number>) => string
): string {
  if (language === "en") {
    return t(count === 1 ? "councilPage.turnCount.one" : "councilPage.turnCount.other", { count });
  }
  return t("councilPage.turnCount", { count });
}
