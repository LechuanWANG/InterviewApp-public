"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import VoiceRecorder, { type LiveAsrSnapshot, type VoiceRecorderHandle } from "./VoiceRecorder";
import { LIVE_CAPTION_ENABLED_KEY, LiveCaptionDock, emptyLiveCaption } from "./LiveCaptionDock";
import { loadVoiceSettings } from "@/lib/voice/settings";
import {
  DEFAULT_VOICE_SETTINGS,
  findDoubaoVoice,
  isRandomDoubaoVoice,
  pickRandomDoubaoVoice,
  type VoiceSettings,
} from "@/lib/voice/types";
import { speak, stopSpeaking } from "@/lib/voice/tts";
import { isClosingInterviewPrompt } from "@/lib/interview/endDetection";
import type { InterviewMode, InterviewPlanCouncil } from "@/lib/types";
import { useI18n } from "./LanguageProvider";
import ExperienceRating from "./ExperienceRating";
import LoadingIndicator, { LoadingDots } from "./LoadingIndicator";
import { CouncilStyles } from "./council/CouncilStyles";

type Phase = "intro" | "speaking" | "waiting" | "recording" | "transcribing" | "reviewed" | "submitting" | "done";
type HistoryItem = { q: string; a: string };
type InterviewerAvatarSet = "1" | "2" | "3" | "4";
type QuestionIntentView = {
  question?: string;
  purpose: string;
  raisedBy?: string;
  relatedTopics: string[];
};

const INTERVIEWER_AVATAR_SETS: InterviewerAvatarSet[] = ["1", "2", "3", "4"];
const INTERVIEWER_AVATAR_BASE = "/avatars/one-on-one-interviewer";
const FOLLOW_UP_IMAGE_COUNT = 5;
const COUNCIL_INTERVIEW_TRANSITION_KEY = "interview-council-enter-transition";

export default function InterviewChat({
  sessionId,
  initialQuestion,
  language,
  initialRound,
  totalRounds,
  answerTimeSec,
  mode,
  focusAreas,
  council,
  showCouncilIntro = false,
}: {
  sessionId: string;
  initialQuestion: string;
  language: "zh" | "en";
  initialRound: number;
  totalRounds: number;
  answerTimeSec: number;
  mode: InterviewMode;
  focusAreas: string[];
  council?: InterviewPlanCouncil;
  showCouncilIntro?: boolean;
}) {
  const { t } = useI18n();
  const hasCouncilIntro = showCouncilIntro && !!council && initialRound <= 1;
  const [question, setQuestion] = useState(initialQuestion);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<VoiceSettings>(DEFAULT_VOICE_SETTINGS);
  const [phase, setPhase] = useState<Phase>(hasCouncilIntro ? "intro" : mode === "simulate" ? "speaking" : "waiting");
  const [timeLeft, setTimeLeft] = useState(answerTimeSec);
  const [round, setRound] = useState(initialRound);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [avatarSet, setAvatarSet] = useState<InterviewerAvatarSet | null>(null);
  const [avatarSrc, setAvatarSrc] = useState<string | null>(null);
  const [enteringFromCouncil, setEnteringFromCouncil] = useState(false);
  const [liveCaptionOpen, setLiveCaptionOpen] = useState(false);
  const [liveCaption, setLiveCaption] = useState<LiveAsrSnapshot>(emptyLiveCaption());

  const recorderRef = useRef<VoiceRecorderHandle>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const submittingRef = useRef(false);
  const effectiveVoiceRef = useRef("");
  const transcriptRef = useRef("");
  const speakGenRef = useRef(0);
  const speakingKeyRef = useRef("");
  const lastFollowUpAvatarRef = useRef<string | null>(null);
  const interviewEndedRef = useRef(false);
  const liveCaptionTextRef = useRef("");
  const startingRecordingRef = useRef(false);
  useEffect(() => { setSettings(normalizeInterviewVoiceSettings(loadVoiceSettings())); }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LIVE_CAPTION_ENABLED_KEY);
      if (saved === "0") setLiveCaptionOpen(false);
      if (saved === "1") setLiveCaptionOpen(true);
    } catch {}
  }, []);

  useEffect(() => {
    if (sessionStorage.getItem(COUNCIL_INTERVIEW_TRANSITION_KEY) !== "1") return;
    sessionStorage.removeItem(COUNCIL_INTERVIEW_TRANSITION_KEY);
    setEnteringFromCouncil(true);
    const timer = window.setTimeout(() => setEnteringFromCouncil(false), 1120);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (mode !== "simulate") return;
    const storageKey = `interview-avatar-set:${sessionId}`;
    const saved = sessionStorage.getItem(storageKey);
    const nextSet = isInterviewerAvatarSet(saved)
      ? saved
      : INTERVIEWER_AVATAR_SETS[Math.floor(Math.random() * INTERVIEWER_AVATAR_SETS.length)];
    sessionStorage.setItem(storageKey, nextSet);
    setAvatarSet(nextSet);
    lastFollowUpAvatarRef.current = null;
    setAvatarSrc(getOpeningAvatarSrc(nextSet));
  }, [mode, sessionId]);

  // 同步更新 ref + state，确保 handleSubmit 能立即读到最新值
  function appendTranscript(text: string) {
    const updated = transcriptRef.current ? `${transcriptRef.current} ${text}` : text;
    transcriptRef.current = updated;
    setTranscript(updated);
  }

  function resetTranscript() {
    transcriptRef.current = "";
    setTranscript("");
    resetLiveCaption();
  }

  function setTranscriptValue(text: string) {
    transcriptRef.current = text;
    setTranscript(text);
  }

  function enterManualAnswerReview(message: string) {
    const recoveredFromLiveCaption = applyLiveCaptionAsTranscript();
    setError(recoveredFromLiveCaption ? null : message);
    setPhase("reviewed");
  }
  useEffect(() => () => { stopSpeaking(); clearTimer(); }, []);

  useEffect(() => {
    if (settings.tts === "doubao" && isRandomDoubaoVoice(settings.voice)) {
      effectiveVoiceRef.current = pickRandomDoubaoVoice(language).id;
    } else {
      effectiveVoiceRef.current = settings.voice;
    }
  }, [settings.tts, settings.voice, language]);

  const voiceSettings = useMemo<VoiceSettings>(() => ({
    ...settings,
    voice: settings.tts === "doubao" && isRandomDoubaoVoice(settings.voice)
      ? effectiveVoiceRef.current || pickRandomDoubaoVoice(language).id
      : settings.voice,
  }), [settings, language]);

  const currentIntent = useMemo(() => {
    return findQuestionIntent(question, council, language);
  }, [council, question, language]);

  const liveTranscriptionActive = settings.asr === "doubao";

  function resetLiveCaption() {
    const empty = emptyLiveCaption();
    liveCaptionTextRef.current = "";
    setLiveCaption(empty);
  }

  function updateLiveCaption(snapshot: LiveAsrSnapshot) {
    const text = (snapshot.finalText || snapshot.text || snapshot.interimText || "").trim();
    liveCaptionTextRef.current = text;
    setLiveCaption(snapshot);
  }

  function applyLiveCaptionAsTranscript(): boolean {
    const text = liveCaptionTextRef.current.trim();
    if (!text || transcriptRef.current.trim()) return false;
    setTranscriptValue(text);
    return true;
  }

  function toggleLiveCaption(checked: boolean) {
    setLiveCaptionOpen(checked);
    try {
      localStorage.setItem(LIVE_CAPTION_ENABLED_KEY, checked ? "1" : "0");
    } catch {}
  }

  function shouldUseLiveTranscript(): boolean {
    return liveTranscriptionActive && Boolean(liveCaptionTextRef.current.trim());
  }

  function clearTimer() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }

  async function startRecordingAndTimer() {
    if (interviewEndedRef.current || startingRecordingRef.current) return;
    const recorder = recorderRef.current;
    if (!recorder) {
      setError(t("interview.recorderNotReady"));
      setPhase("waiting");
      return;
    }

    startingRecordingRef.current = true;
    setError(null);
    setPhase("recording");
    setTimeLeft(answerTimeSec);
    clearTimer();
    try {
      const started = await recorder.startRecording();
      if (interviewEndedRef.current) return;
      if (!started.ok) {
        setError(started.error);
        setPhase("waiting");
        return;
      }
      timerRef.current = setInterval(() => {
        setTimeLeft((t) => {
          if (t <= 1) {
            clearTimer();
            handleSubmit(true);
            return 0;
          }
          return t - 1;
        });
      }, 1000);
    } finally {
      startingRecordingRef.current = false;
    }
  }

  function startCouncilDesignedInterview() {
    setPhase(mode === "simulate" ? "speaking" : "waiting");
  }

  // 题目切换 effect
  useEffect(() => {
    if (!question || phase === "intro" || phase === "done" || interviewEndedRef.current) return;
    const key = `${round}:${question}`;
    // 防止 StrictMode 双重执行导致同一题播放两次
    if (speakingKeyRef.current === key) return;
    speakingKeyRef.current = key;
    const gen = ++speakGenRef.current;
    resetTranscript();
    setTimeLeft(answerTimeSec);
    clearTimer();
    setError(null);

    if (mode === "practice") {
      setPhase("waiting");
      return;
    }

    // 模拟模式
    if (avatarSet) {
      if (round <= 1) {
        lastFollowUpAvatarRef.current = null;
        setAvatarSrc(getOpeningAvatarSrc(avatarSet));
      } else {
        const nextAvatar = getRandomFollowUpAvatarSrc(avatarSet, lastFollowUpAvatarRef.current);
        lastFollowUpAvatarRef.current = nextAvatar;
        setAvatarSrc(nextAvatar);
      }
    }

    const ttsOff = !voiceSettings.autoPlay || voiceSettings.tts === "off";
    if (ttsOff) {
      setTimeout(() => {
        if (speakGenRef.current === gen && !interviewEndedRef.current) startRecordingAndTimer();
      }, 100);
      return;
    }

    setPhase("speaking");
    (async () => {
      try {
        await speak(question, voiceSettings, language);
      } catch (err) {
        if (speakGenRef.current === gen) {
          setError(err instanceof Error ? err.message : "朗读失败");
        }
      }
      if (speakGenRef.current === gen && !interviewEndedRef.current) startRecordingAndTimer();
    })();
  }, [question, round]);

  // 练习模式：手动播放
  async function playQuestion() {
    if (voiceSettings.tts === "off") return;
    const prevPhase = phase;
    setPhase("speaking");
    try {
      await speak(question, voiceSettings, language);
    } catch (err) {
      setError(err instanceof Error ? err.message : "朗读失败");
    }
    if (phase !== "recording") setPhase(prevPhase === "recording" ? "recording" : "waiting");
  }

  // 练习模式：停止录音并等待 ASR 解析
  async function stopAndTranscribe() {
    clearTimer();
    const useLiveTranscript = shouldUseLiveTranscript();
    if (!useLiveTranscript) setPhase("transcribing");
    if (recorderRef.current) {
      const result = useLiveTranscript
        ? await recorderRef.current.stopAndUseLiveTranscript()
        : await recorderRef.current.stopAndWaitForTranscript();
      if (!result.ok) {
        enterManualAnswerReview(result.error || t("interview.transcribeFailed"));
        return;
      }
    }
    setPhase("reviewed");
  }

  async function stopCurrentRecording() {
    clearTimer();
    const useLiveTranscript = shouldUseLiveTranscript();
    if (!useLiveTranscript) setPhase("transcribing");
    if (recorderRef.current) {
      const result = useLiveTranscript
        ? await recorderRef.current.stopAndUseLiveTranscript()
        : await recorderRef.current.stopAndWaitForTranscript();
      if (!result.ok) {
        enterManualAnswerReview(result.error || t("interview.transcribeFailed"));
        return;
      }
    }
    if (!transcriptRef.current.trim()) {
      enterManualAnswerReview(t("interview.noRecognizedAnswer"));
      return;
    }
    setPhase("reviewed");
  }

  async function handleSubmit(timedOut = false) {
    if (submittingRef.current || phase === "done") return;
    submittingRef.current = true;
    clearTimer();
    stopSpeaking();

    // reviewed 阶段已经完成识别或进入手动补救，不再重复触发 ASR。
    if (phase !== "reviewed" && recorderRef.current) {
      const useLiveTranscript = shouldUseLiveTranscript();
      if (!useLiveTranscript) setPhase("transcribing");
      const result = useLiveTranscript
        ? await recorderRef.current.stopAndUseLiveTranscript()
        : await recorderRef.current.stopAndWaitForTranscript();
      if (!result.ok) {
        enterManualAnswerReview(result.error || t("interview.transcribeFailed"));
        submittingRef.current = false;
        return;
      }
    }

    setPhase("submitting");

    const text = transcriptRef.current.trim();
    if (!text && !timedOut) {
      setError(t("interview.noRecognizedAnswer"));
      setPhase("reviewed");
      submittingRef.current = false;
      return;
    }
    const finalAnswer = text || (timedOut
      ? (language === "en" ? t("interview.noAnswerTimer") : "未在倒计时内作答")
      : (language === "en" ? t("interview.noAnswer") : "未作答"));

    // 练习模式：保存历史
    if (mode === "practice") {
      setHistory((h) => [...h, { q: question, a: finalAnswer }]);
    }

    try {
      const res = await fetch(`/api/session/${sessionId}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer: finalAnswer, timedOut, question }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "提交失败");
      if (data.done || isClosingInterviewPrompt(data.question || "")) {
        interviewEndedRef.current = true;
        speakGenRef.current += 1;
        clearTimer();
        stopSpeaking();
        recorderRef.current?.stopRecording();
        if (data.question) setQuestion(data.question);
        if (avatarSet) setAvatarSrc(getEndingAvatarSrc(avatarSet));
        setPhase("done");
      } else {
        setQuestion(data.question);
        setRound((r) => r + 1);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败");
      setPhase("recording");
    } finally {
      submittingRef.current = false;
    }
  }

  async function finishAndReport() {
    stopSpeaking();
    setGeneratingReport(true);
    try {
      const res = await fetch(`/api/session/${sessionId}/report`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "生成报告失败");
      window.location.assign(`/report/${sessionId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成报告失败");
      setGeneratingReport(false);
    }
  }

  async function retryTranscription() {
    if (!recorderRef.current) return;
    setError(null);
    setPhase("transcribing");
    const result = await recorderRef.current.retryLastTranscription();
    if (!result.ok) {
      enterManualAnswerReview(result.error || t("interview.transcribeFailed"));
      return;
    }
    setPhase("reviewed");
  }

  const progressPercent = Math.max(0, Math.min(100, (timeLeft / Math.max(answerTimeSec, 1)) * 100));

  return (
    <div className={`relative space-y-4 ${enteringFromCouncil ? "council-interview-fade-in" : ""}`}>
      <CouncilStyles />
      {phase === "intro" && council && (
        <CouncilIntroCard
          council={council}
          focusAreas={focusAreas}
          onStart={startCouncilDesignedInterview}
        />
      )}

      {phase !== "intro" && (
      <div className="bg-white border rounded-md p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs text-slate-500">{t("interview.currentQuestion")}</div>
            <div className="text-sm font-medium">
              {t("interview.questionCount", {
                round,
                total: Math.max(totalRounds, round),
              })}
            </div>
          </div>
        </div>

        {/* 倒计时 */}
        <div>
          <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
            <span>{t("interview.countdown")}</span>
            <span>
              {phase === "recording" ? `${timeLeft}s`
                : phase === "speaking" ? t("interview.speaking")
                : phase === "submitting" ? t("interview.submitting")
                : phase === "waiting" ? t("interview.waiting")
                : t("interview.ended")}
            </span>
          </div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            {phase === "recording" ? (
              <div className={`h-full ${timeLeft <= 30 ? "bg-red-500" : "bg-slate-900"} transition-all`} style={{ width: `${progressPercent}%` }} />
            ) : phase === "speaking" ? (
              <div className="h-full w-full bg-emerald-300 animate-pulse" />
            ) : (
              <div className="h-full bg-slate-200" style={{ width: "100%" }} />
            )}
          </div>
        </div>

        <div className="space-y-4">
        {mode === "simulate" && avatarSrc && (
          <InterviewerPortrait src={avatarSrc} />
        )}

        {/* 面试官问题 */}
        <div className="rounded-md border bg-slate-50 p-4">
          <div className="text-xs text-slate-500 mb-2 flex items-center gap-2">
            <span>{t("interview.question")}</span>
            {phase === "speaking" && <span className="text-emerald-600">{t("interview.reading")}</span>}
          </div>
          <div className="text-base leading-7 whitespace-pre-wrap">{question}</div>
        </div>

        {mode === "practice" && currentIntent && (
          <QuestionIntentCard intent={currentIntent} />
        )}

        {/* waiting（练习模式）*/}
        {phase === "waiting" && (
          <div className="flex items-center justify-center gap-4 py-2">
            {voiceSettings.tts !== "off" && (
              <button onClick={playQuestion} className="border border-slate-300 text-slate-700 rounded-md px-4 py-2 text-sm hover:bg-slate-50">
                {t("interview.playQuestion")}
              </button>
            )}
            <button onClick={startRecordingAndTimer} className="bg-red-600 text-white rounded-md px-6 py-2 text-sm font-medium">
              {t("interview.startRecordingTimer")}
            </button>
          </div>
        )}

        {/* speaking（模拟模式）*/}
        {phase === "speaking" && (
          <div className="text-sm text-slate-500 text-center py-2">{t("interview.listenCarefully")}</div>
        )}

        {/* VoiceRecorder 始终挂载，避免卸载导致 ASR promise 丢失 */}
        <div className={phase === "recording" ? "" : "hidden"}>
          <div className="space-y-3">
            <VoiceRecorder
              ref={recorderRef}
              asr={settings.asr}
              language={language}
              hideControls
              liveTranscriptionEnabled={liveTranscriptionActive}
              onLiveTranscript={updateLiveCaption}
              onTranscript={(text) => appendTranscript(text)}
            />
            {mode === "practice" ? (
              <div className="flex items-center justify-center py-2">
                <button onClick={stopAndTranscribe} className="bg-slate-900 text-white rounded-md px-6 py-2 text-sm font-medium">
                  {t("interview.stopTranscribe")}
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-4">
                <button onClick={stopCurrentRecording} className="text-xs text-slate-600 underline">
                  {t("interview.stopRecording")}
                </button>
                <button onClick={() => handleSubmit(false)} className="bg-slate-900 text-white rounded-md px-5 py-2 text-sm">
                  {t("interview.submitNext")}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* transcribing：等待 ASR */}
        {phase === "transcribing" && (
          <div className="flex justify-center py-4">
            <LoadingIndicator variant="inline" label={t("interview.transcribing")} />
          </div>
        )}

        {/* reviewed：练习模式，显示识别结果，用户确认后提交 */}
        {phase === "reviewed" && (
          <div className="space-y-3">
            <div className="rounded-md border bg-white p-4">
              <div className="text-xs text-slate-500 mb-2">{t("interview.yourAnswer")}</div>
              <textarea
                value={transcript}
                onChange={(event) => setTranscriptValue(event.target.value)}
                placeholder={t("interview.manualAnswerPlaceholder")}
                className="w-full min-h-28 resize-y rounded-md border border-slate-200 bg-white p-3 text-sm leading-6 outline-none focus:border-slate-400"
              />
              {!transcript && (
                <div className="mt-2 text-xs text-slate-400">{t("interview.noTranscript")}</div>
              )}
            </div>
            <div className="flex items-center justify-center gap-4 py-2">
              <button onClick={retryTranscription} className="border border-slate-300 text-slate-700 rounded-md px-4 py-2 text-sm hover:bg-slate-50">
                {t("interview.retryTranscribe")}
              </button>
              <button onClick={() => { resetTranscript(); startRecordingAndTimer(); }} className="border border-slate-300 text-slate-700 rounded-md px-4 py-2 text-sm hover:bg-slate-50">
                {t("interview.recordAgain")}
              </button>
              <button onClick={() => handleSubmit(false)} className="bg-slate-900 text-white rounded-md px-5 py-2 text-sm font-medium">
                {t("interview.confirmNext")}
              </button>
            </div>
          </div>
        )}

        {phase === "submitting" && (
          <div className="flex justify-center py-4">
            <LoadingIndicator variant="inline" label={t("interview.generatingNext")} />
          </div>
        )}
        </div>

      </div>
      )}

      {phase !== "intro" && phase !== "done" && settings.asr === "doubao" && (
        <LiveCaptionDock
          open={liveCaptionOpen}
          snapshot={liveCaption}
          onOpenChange={toggleLiveCaption}
        />
      )}

      {/* 练习模式：历史问答记录 */}
      {mode === "practice" && history.length > 0 && (
        <div className="bg-white border rounded-md p-5">
          <div className="text-sm font-medium mb-3">{t("interview.practiceHistory")}</div>
          <div className="space-y-3">
            {history.map((item, i) => (
              <div key={i} className="border-l-2 border-slate-200 pl-3">
                <div className="text-xs text-slate-500">{t("interview.round", { index: i + 1 })}</div>
                <div className="text-sm font-medium mt-1">Q: {item.q}</div>
                <div className="text-sm text-slate-700 mt-1 whitespace-pre-wrap">A: {item.a}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {phase === "done" && (
        <div className="space-y-3">
          <div className="bg-emerald-50 border border-emerald-200 rounded-md p-4 flex items-center justify-between gap-4">
            <span className="text-sm">{t("interview.doneText")}</span>
            <button onClick={finishAndReport} disabled={generatingReport} className="inline-flex items-center gap-2 bg-emerald-600 text-white rounded-md px-4 py-2 text-sm disabled:opacity-50">
              {generatingReport ? (
                <>
                  <LoadingDots />
                  {t("interview.generatingReport")}
                </>
              ) : (
                t("interview.viewReport")
              )}
            </button>
          </div>
          <ExperienceRating kind="interview" targetId={sessionId} />
        </div>
      )}

      {error && <div className="text-red-600 text-sm">{error}</div>}
    </div>
  );
}

function CouncilIntroCard({
  council,
  focusAreas,
  onStart,
}: {
  council: InterviewPlanCouncil;
  focusAreas: string[];
  onStart: () => void;
}) {
  const { t } = useI18n();
  const topics = council.consensus.priorityTopics.length
    ? council.consensus.priorityTopics
    : focusAreas.map((topic) => ({
        topic,
        priority: "medium" as const,
        reason: "",
        source: [] as ("jd" | "resume" | "risk" | "strategy")[],
      }));

  return (
    <section className="overflow-hidden rounded-3xl border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-sky-50 shadow-sm">
      <div className="border-b border-amber-100 px-5 py-4">
        <div className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-700">
          {t("council.kicker")}
        </div>
        <h2 className="mt-2 text-2xl font-semibold text-slate-950">{t("council.title")}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          {council.consensus.summary || t("council.defaultSummary")}
        </p>
      </div>

      <div className="grid gap-4 px-5 py-5 md:grid-cols-2">
        {council.experts.slice(0, 4).map((expert) => (
          <div key={expert.role} className="rounded-2xl border border-white/70 bg-white/75 p-4 shadow-sm">
            <div className="text-sm font-semibold text-slate-900">{expert.role}</div>
            <div className="mt-1 text-xs leading-5 text-slate-600">{expert.conclusion}</div>
            {expert.keyFindings.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {expert.keyFindings.slice(0, 3).map((finding) => (
                  <span key={finding} className="rounded-full bg-slate-100 px-2 py-1 text-[11px] text-slate-600">
                    {finding}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="grid gap-4 px-5 pb-5 md:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-2xl border border-slate-200 bg-white/80 p-4">
          <div className="text-sm font-semibold text-slate-900">{t("council.topicMap")}</div>
          <div className="mt-3 space-y-3">
            {topics.slice(0, 5).map((topic) => (
              <div key={topic.topic}>
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="font-medium text-slate-700">{topic.topic}</span>
                  <span className="text-slate-500">{t(`council.priority.${topic.priority}`)}</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full ${priorityBarClass(topic.priority)}`}
                    style={{ width: priorityWidth(topic.priority) }}
                  />
                </div>
                {topic.reason && <div className="mt-1 text-xs text-slate-500">{topic.reason}</div>}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-rose-100 bg-white/80 p-4">
          <div className="text-sm font-semibold text-slate-900">{t("council.predictedRisks")}</div>
          <div className="mt-3 space-y-3">
            {council.consensus.predictedRisks.slice(0, 3).map((risk) => (
              <div key={risk.risk} className="rounded-xl bg-rose-50 px-3 py-2">
                <div className="text-xs font-medium text-rose-900">{risk.risk}</div>
                <div className="mt-1 text-[11px] leading-5 text-rose-700">{risk.whyItMatters}</div>
              </div>
            ))}
            {council.consensus.predictedRisks.length === 0 && (
              <div className="text-xs leading-5 text-slate-500">{t("council.noRisks")}</div>
            )}
          </div>
        </div>
      </div>

      {council.consensus.disagreements.length > 0 && (
        <details className="mx-5 mb-5 rounded-2xl border border-slate-200 bg-white/70 p-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-800">
            {t("council.disagreements")}
          </summary>
          <div className="mt-3 space-y-3">
            {council.consensus.disagreements.map((item) => (
              <div key={item.issue} className="text-xs leading-5 text-slate-600">
                <div className="font-medium text-slate-800">{item.issue}</div>
                <div>{item.finalDecision}</div>
              </div>
            ))}
          </div>
        </details>
      )}

      <div className="flex flex-col gap-3 border-t border-amber-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs text-slate-500">{t("council.ready")}</div>
        <button
          type="button"
          onClick={onStart}
          className="rounded-full bg-slate-950 px-5 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          {t("council.start")}
        </button>
      </div>
    </section>
  );
}

function QuestionIntentCard({
  intent,
}: {
  intent: QuestionIntentView;
}) {
  const { t } = useI18n();
  return (
    <div className="rounded-2xl border border-sky-100 bg-sky-50/70 p-4">
      <div className="text-xs font-semibold text-sky-900">{t("council.questionIntent")}</div>
      <div className="mt-1 text-sm leading-6 text-slate-700">{intent.purpose}</div>
      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-500">
        {intent.raisedBy && <span className="rounded-full bg-white px-2 py-1">{intent.raisedBy}</span>}
        {intent.relatedTopics.map((topic) => (
          <span key={topic} className="rounded-full bg-white px-2 py-1">{topic}</span>
        ))}
      </div>
    </div>
  );
}

function findQuestionIntent(
  question: string,
  council: InterviewPlanCouncil | undefined,
  language: "zh" | "en"
): QuestionIntentView | null {
  if (!council || !question.trim()) return null;

  const intents = council.consensus.questionIntents ?? [];
  const normalizedQuestion = normalizeQuestionForIntent(question);
  const exactIntent = intents.find((item) => normalizeQuestionForIntent(item.question) === normalizedQuestion);
  if (exactIntent) return normalizeQuestionIntent(exactIntent);

  const looseIntent = intents.find((item) => {
    const normalizedIntentQuestion = normalizeQuestionForIntent(item.question);
    return normalizedIntentQuestion.length > 8 &&
      (normalizedQuestion.includes(normalizedIntentQuestion) || normalizedIntentQuestion.includes(normalizedQuestion));
  });
  if (looseIntent) return normalizeQuestionIntent(looseIntent);

  const matchedTopic = findBestIntentTopic(question, council.consensus.priorityTopics);
  if (!matchedTopic) return null;
  const focus = matchedTopic.followUpGoals?.[0] || matchedTopic.reason || matchedTopic.exitCriteria?.[0] || matchedTopic.topic;
  return {
    question,
    purpose: language === "en"
      ? `Validate ${matchedTopic.topic}: ${focus}`
      : `验证「${matchedTopic.topic}」：${focus}`,
    raisedBy: matchedTopic.source?.length
      ? matchedTopic.source.map((source) => intentSourceLabel(source, language)).join(" + ")
      : (language === "en" ? "AI council" : "AI 智囊团"),
    relatedTopics: [matchedTopic.topic],
  };
}

function normalizeQuestionIntent(
  intent: NonNullable<InterviewPlanCouncil["consensus"]["questionIntents"]>[number]
): QuestionIntentView {
  return {
    question: intent.question,
    purpose: intent.purpose,
    raisedBy: intent.raisedBy,
    relatedTopics: Array.isArray(intent.relatedTopics) ? intent.relatedTopics : [],
  };
}

function findBestIntentTopic(
  question: string,
  topics: InterviewPlanCouncil["consensus"]["priorityTopics"]
): InterviewPlanCouncil["consensus"]["priorityTopics"][number] | null {
  const ranked = topics
    .map((topic) => {
      const candidates = [
        topic.mainQuestion,
        topic.topic,
        topic.reason,
        ...(topic.followUpGoals ?? []),
        ...(topic.exitCriteria ?? []),
      ].filter((item): item is string => Boolean(item));
      const score = Math.max(...candidates.map((candidate) => questionMatchScore(question, candidate)), 0);
      return { topic, score };
    })
    .sort((left, right) => right.score - left.score);
  return ranked[0] && ranked[0].score >= 16 ? ranked[0].topic : null;
}

function questionMatchScore(question: string, candidate: string): number {
  const normalizedQuestion = normalizeQuestionForIntent(question);
  const normalizedCandidate = normalizeQuestionForIntent(candidate);
  if (!normalizedQuestion || !normalizedCandidate) return 0;
  if (normalizedQuestion === normalizedCandidate) return 100;
  if (normalizedCandidate.length >= 8 && normalizedQuestion.includes(normalizedCandidate)) return 82;
  if (normalizedQuestion.length >= 8 && normalizedCandidate.includes(normalizedQuestion)) return 76;
  return meaningfulIntentTokens(candidate)
    .map(normalizeQuestionForIntent)
    .filter(Boolean)
    .reduce((score, token) => score + (normalizedQuestion.includes(token) ? 8 : 0), 0);
}

function meaningfulIntentTokens(value: string): string[] {
  const wordTokens = value.match(/[A-Za-z][A-Za-z0-9_-]{3,}/g) ?? [];
  const hanChunks = value.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  const hanTokens = hanChunks.flatMap((chunk) => {
    if (chunk.length <= 4) return [chunk];
    return Array.from({ length: chunk.length - 1 }, (_, index) => chunk.slice(index, index + 2));
  });
  return Array.from(new Set([...wordTokens, ...hanTokens]));
}

function intentSourceLabel(source: "jd" | "resume" | "risk" | "strategy", language: "zh" | "en"): string {
  if (language === "en") {
    if (source === "jd") return "JD";
    if (source === "resume") return "Resume";
    if (source === "risk") return "Risk";
    return "Strategy";
  }
  if (source === "jd") return "JD 解构官";
  if (source === "resume") return "简历深挖官";
  if (source === "risk") return "风险质疑官";
  return "面试策略官";
}

function normalizeQuestionForIntent(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, "");
}

function priorityWidth(priority: "high" | "medium" | "low"): string {
  if (priority === "high") return "92%";
  if (priority === "low") return "46%";
  return "70%";
}

function priorityBarClass(priority: "high" | "medium" | "low"): string {
  if (priority === "high") return "bg-amber-500";
  if (priority === "low") return "bg-sky-400";
  return "bg-emerald-500";
}

function normalizeInterviewVoiceSettings(settings: VoiceSettings): VoiceSettings {
  if (settings.tts !== "doubao") return settings;
  if (!settings.voice || isRandomDoubaoVoice(settings.voice) || findDoubaoVoice(settings.voice)) {
    return settings;
  }
  return { ...settings, voice: DEFAULT_VOICE_SETTINGS.voice };
}

function InterviewerPortrait({ src }: { src: string }) {
  return (
    <div className="flex justify-center">
      <img
        src={src}
        alt="interviewer avatar"
        loading="eager"
        decoding="sync"
        className="max-h-[28rem] w-auto max-w-full object-contain"
      />
    </div>
  );
}

function isInterviewerAvatarSet(value: string | null): value is InterviewerAvatarSet {
  return value === "1" || value === "2" || value === "3" || value === "4";
}

function getOpeningAvatarSrc(set: InterviewerAvatarSet): string {
  return `${INTERVIEWER_AVATAR_BASE}/${set}/opening.jpg`;
}

function getEndingAvatarSrc(set: InterviewerAvatarSet): string {
  return `${INTERVIEWER_AVATAR_BASE}/${set}/ending.jpg`;
}

function getRandomFollowUpAvatarSrc(set: InterviewerAvatarSet, previousSrc?: string | null): string {
  const previousIndex = previousSrc?.match(/follow-up-(\d+)\.jpg$/)?.[1];
  const candidates = Array.from({ length: FOLLOW_UP_IMAGE_COUNT }, (_, index) => index + 1).filter(
    (index) => String(index) !== previousIndex
  );
  const pool = candidates.length ? candidates : [1];
  const index = pool[Math.floor(Math.random() * pool.length)];
  return `${INTERVIEWER_AVATAR_BASE}/${set}/follow-up-${index}.jpg`;
}
