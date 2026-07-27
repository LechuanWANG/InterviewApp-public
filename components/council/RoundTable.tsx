import type { UiLanguage } from "@/lib/i18n";
import { useI18n } from "../LanguageProvider";
import { CouncilThinkingAnimation } from "./CouncilThinkingAnimation";
import type { CouncilResult, CouncilTurn, SpeakerState } from "./types";
import {
  firstMeaningfulLine,
  isModeratorRole,
  isRiskRole,
  localizedSpeakerRole,
  phaseLabel,
  resolutionBadgeClass,
  resolutionStatusLabel,
  speakerPosition,
  trimText,
} from "./utils";

export function RoundTable({
  speakers,
  activeRole,
  spotlight,
  thinkingStatus,
  done,
  interviewLanguage,
  onStart,
  expanded = false,
}: {
  speakers: SpeakerState[];
  activeRole: string | null;
  spotlight: CouncilTurn | null;
  thinkingStatus?: string | null;
  done: boolean;
  interviewLanguage: "zh" | "en";
  onStart?: () => void;
  expanded?: boolean;
}) {
  const { t, language: uiLanguage } = useI18n();
  const displaySpotlight = spotlight || (done
    ? {
        role: t("councilPage.consensusHost"),
        phase: "consensus" as const,
        result: { conclusion: t("councilPage.consensusDone"), satisfied: true },
      }
    : null);
  return (
    <div className="relative mx-auto min-h-[34rem] w-full max-w-[42rem]">
      <div className="absolute inset-8 rounded-full border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-sky-50 shadow-inner" />
      <div className="absolute inset-20 rounded-full border border-slate-200 bg-white/70" />

      {speakers.map((speaker, index) => (
        <SpeakerNode
          key={speaker.role}
          speaker={speaker}
          active={speaker.role === activeRole}
          position={speakerPosition(index)}
          language={uiLanguage}
        />
      ))}

      <div className={`pointer-events-none absolute left-1/2 top-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center text-center ${expanded ? "w-[18rem] sm:w-[23rem]" : "w-[16rem] sm:w-[19rem]"}`}>
        <div
          key={`${displaySpotlight?.role || "waiting"}-${displaySpotlight?.phase || "idle"}-${displaySpotlight?.result.conclusion || ""}`}
          className="council-fade-in w-full overflow-hidden"
        >
          <div className="break-words bg-gradient-to-r from-amber-700 via-orange-500 to-sky-600 bg-clip-text text-xs font-semibold uppercase tracking-[0.22em] text-transparent [overflow-wrap:anywhere]">
            {displaySpotlight ? phaseLabel(displaySpotlight.phase, t) : t("councilPage.roundTable")}
          </div>
          <div className="mx-auto mt-2 max-w-full truncate bg-gradient-to-r from-slate-950 via-amber-700 to-sky-800 bg-clip-text text-xl font-semibold text-transparent drop-shadow-sm">
            {displaySpotlight ? localizedSpeakerRole(displaySpotlight.role, t) : t("councilPage.waitingRole")}
          </div>
          <div className={`mt-3 flex w-full items-center justify-center overflow-hidden break-words text-slate-700 drop-shadow-sm [overflow-wrap:anywhere] ${expanded ? "min-h-[7.75rem] text-sm leading-6" : "min-h-[6.25rem] text-sm leading-6"}`}>
            {displaySpotlight ? (
              isThinkingResult(displaySpotlight.result) ? (
                <CouncilThinkingAnimation
                  role={displaySpotlight.role}
                  phase={displaySpotlight.phase}
                  status={thinkingStatus}
                />
              ) : (
                <SpotlightContent
                  result={displaySpotlight.result}
                  role={displaySpotlight.role}
                  language={interviewLanguage}
                  phase={displaySpotlight.phase}
                />
              )
            ) : null}
          </div>
          {done && onStart && (
            <button
              type="button"
              onClick={onStart}
              className="pointer-events-auto mt-4 rounded-full bg-slate-950 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-slate-900/15 transition hover:-translate-y-0.5 hover:bg-emerald-700"
            >
              {t("council.start")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function SpeakerNode({
  speaker,
  active,
  position,
  language,
}: {
  speaker: SpeakerState;
  active: boolean;
  position: { left: string; top: string; transform: string };
  language: UiLanguage;
}) {
  const { t } = useI18n();
  const isRisk = isRiskRole(speaker.role);
  const pending = speaker.status === "speaking"
    ? t("councilPage.status.reviewing")
    : t("councilPage.status.pendingRevision");
  const inputCaptured = t("councilPage.status.inputCaptured");
  const riskCaptured = t("councilPage.status.riskCaptured");
  return (
    <div
      className="absolute z-20 w-32"
      style={{ left: position.left, top: position.top, transform: position.transform }}
    >
      <div className={`rounded-2xl border px-3 py-3 text-center shadow-sm transition-all duration-500 ease-out ${
        active
          ? "scale-105 border-amber-300 bg-gradient-to-br from-amber-100 to-orange-50 text-amber-950 shadow-lg shadow-amber-100/70"
          : speaker.status === "done"
            ? "border-emerald-200 bg-gradient-to-br from-emerald-50 to-white text-emerald-800"
            : "border-slate-200 bg-gradient-to-br from-white to-slate-50 text-slate-600"
      }`}>
        <div className={`mx-auto mb-2 h-3 w-3 rounded-full ${
          active ? "bg-amber-500 animate-pulse" : speaker.status === "done" ? "bg-emerald-500" : "bg-slate-300"
        }`} />
        <div className="text-xs font-semibold leading-4">{localizedSpeakerRole(speaker.role, t)}</div>
        {speaker.status !== "idle" && !isModeratorRole(speaker.role) && (
          <div className="mt-2">
            {!isRisk ? (
              <div className={`rounded-full px-2 py-1 text-[10px] font-medium ${
                speaker.status === "speaking"
                  ? "bg-amber-100 text-amber-700"
                  : "bg-emerald-100 text-emerald-700"
              }`}>
                {speaker.status === "speaking" ? pending : inputCaptured}
              </div>
            ) : speaker.finalStatus ? (
              <div className={`rounded-full px-2 py-1 text-[10px] font-medium ${resolutionBadgeClass(speaker.finalStatus)}`}>
                {resolutionStatusLabel(speaker.finalStatus, t)}
              </div>
            ) : (
              <div className={`rounded-full px-2 py-1 text-[10px] font-medium ${
                speaker.satisfied ? resolutionBadgeClass("approved") : "bg-amber-100 text-amber-700"
              }`}>
                {speaker.satisfied
                  ? resolutionStatusLabel("approved", t)
                  : speaker.status === "speaking"
                    ? pending
                    : (speaker.count <= 1 ? riskCaptured : pending)}
              </div>
            )}
          </div>
        )}
        {speaker.count > 0 && <div className="mt-1 text-[10px] opacity-70">{speakerTurnCountLabel(speaker.count, language, t)}</div>}
      </div>
    </div>
  );
}

function SpotlightContent({
  result,
  role,
  language,
  phase,
}: {
  result: CouncilResult;
  role: string;
  language: "zh" | "en";
  phase: CouncilTurn["phase"];
}) {
  const { t } = useI18n();
  const rawPrimary = result.conclusion || firstMeaningfulLine(result);
  const showFull = phase === "consensus";
  const primary = showFull ? rawPrimary : trimText(rawPrimary, language === "en" ? 88 : 64);

  return (
    <div className={`w-full ${showFull ? "overflow-visible" : "overflow-hidden"}`}>
      <div className={`${showFull ? "council-center-primary-full" : "council-center-primary"} mx-auto max-w-full bg-gradient-to-r from-slate-700 via-slate-900 to-sky-700 bg-clip-text text-sm font-medium leading-6 text-transparent`}>
        {primary}
      </div>
      {typeof result.satisfaction === "number" && typeof result.approved === "boolean" && isRiskRole(role) && !isModeratorRole(role) && (
        <div className="mt-2">
          <span className={`rounded-full px-2 py-1 text-xs font-medium ${
            result.satisfied || result.approved ? resolutionBadgeClass("approved") : "bg-amber-100 text-amber-700"
          }`}>
            {result.satisfied || result.approved
              ? resolutionStatusLabel("approved", t)
              : t("councilPage.status.pendingRevision")}
          </span>
        </div>
      )}
    </div>
  );
}

function isThinkingResult(result: CouncilResult): boolean {
  return result.conclusion === "正在整理观点…" || result.conclusion === "Structuring the point…";
}

function speakerTurnCountLabel(
  count: number,
  language: UiLanguage,
  t: (key: string, values?: Record<string, string | number>) => string
): string {
  if (language === "en") {
    return t(count === 1 ? "councilPage.speakerTurnCount.one" : "councilPage.speakerTurnCount.other", { count });
  }
  return t("councilPage.speakerTurnCount", { count });
}
