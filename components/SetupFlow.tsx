"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import VoiceSettingsPanel from "./VoiceSettingsPanel";
import { MODEL_OPTIONS, DEFAULT_MODEL_ID } from "@/lib/llm/models";
import { DIFFICULTIES, getAllowedPersonasForInterviewType } from "@/lib/personas";
import { DEFAULT_VOICE_SETTINGS, type VoiceSettings } from "@/lib/voice/types";
import { saveVoiceSettings } from "@/lib/voice/settings";
import { speak, stopSpeaking } from "@/lib/voice/tts";
import type { InterviewMode } from "@/lib/types";
import { useI18n } from "./LanguageProvider";

const DRAFT_KEY = "interview-create-draft";
const INTERVIEW_TYPE_IDS = new Set(["mixed", "hr", "technical", "behavioral"]);

type DraftPayload = {
  resume: string;
  company: string;
  jobTitle: string;
  jd: string;
  interviewType: string;
  language: "zh" | "en";
};

type SetupStep = "config" | "device";

export default function SetupFlow({ headerAction }: { headerAction?: ReactNode }) {
  const router = useRouter();
  const { t } = useI18n();
  const [draft, setDraft] = useState<DraftPayload | null>(null);
  const [modelId, setModelId] = useState(DEFAULT_MODEL_ID);
  const [useCouncil, setUseCouncil] = useState(true);
  const [persona, setPersona] = useState("pro_expert");
  const [difficulty, setDifficulty] = useState("medium");
  const [settings, setSettings] = useState<VoiceSettings>(DEFAULT_VOICE_SETTINGS);
  const [mode, setMode] = useState<"simulate" | "practice">("simulate");
  const [setupStep, setSetupStep] = useState<SetupStep>("config");
  const [testingModel, setTestingModel] = useState(false);
  const [modelTestResult, setModelTestResult] = useState<string | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [soundTestStatus, setSoundTestStatus] = useState<"idle" | "playing" | "done" | "error">("idle");
  const [micTestStatus, setMicTestStatus] = useState<"idle" | "recording" | "playing" | "ok" | "error">("idle");
  const [micError, setMicError] = useState<string | null>(null);
  const micRecorderRef = useRef<MediaRecorder | null>(null);
  const micChunksRef = useRef<Blob[]>([]);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micAudioRef = useRef<HTMLAudioElement | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      setDraft(JSON.parse(raw) as DraftPayload);
      setSettings(DEFAULT_VOICE_SETTINGS);
    } catch {
      setDraft(null);
    }
  }, []);

  const selectedModel = useMemo(
    () => MODEL_OPTIONS.find((item) => item.id === modelId) ?? MODEL_OPTIONS[0],
    [modelId]
  );
  const interviewTypeLabel = useMemo(() => {
    if (!draft) return "";
    return INTERVIEW_TYPE_IDS.has(draft.interviewType)
      ? t(`type.${draft.interviewType}`)
      : draft.interviewType;
  }, [draft, t]);
  const draftSummary = useMemo(() => {
    if (!draft) return [];
    return [
      draft.company.trim(),
      draft.jobTitle.trim(),
      draft.language === "zh" ? t("setup.zhInterview") : t("setup.enInterview"),
      interviewTypeLabel,
    ].filter(Boolean);
  }, [draft, interviewTypeLabel, t]);
  const allowedPersonas = useMemo(
    () => getAllowedPersonasForInterviewType(draft?.interviewType),
    [draft?.interviewType]
  );

  useEffect(() => {
    if (!allowedPersonas.length) return;
    if (!allowedPersonas.some((item) => item.id === persona)) {
      setPersona(allowedPersonas[0].id);
    }
  }, [allowedPersonas, persona]);

  const deviceReady = soundTestStatus === "done" && micTestStatus === "ok";

  function updateVoiceSettings(nextSettings: VoiceSettings) {
    setSettings(nextSettings);
    setSoundTestStatus("idle");
  }

  function goToDeviceTest() {
    setStartError(null);
    setSetupStep("device");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function goToConfig() {
    setStartError(null);
    setSetupStep("config");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function testModel() {
    setTestingModel(true);
    setModelError(null);
    setModelTestResult(null);
    try {
      const res = await fetch("/api/model/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: selectedModel.provider,
          model: selectedModel.model,
          language: draft?.language || "zh",
          company: draft?.company,
          jobTitle: draft?.jobTitle,
          thinkingEnabled: false,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "模型测试失败");
      setModelTestResult(data.preview || t("setup.modelSuccess"));
    } catch (err) {
      setModelError(err instanceof Error ? err.message : "模型测试失败");
    } finally {
      setTestingModel(false);
    }
  }

  async function testSound() {
    setSoundTestStatus("playing");
    try {
      const testText = draft?.language === "en"
        ? "Hello, this is a voice test. If you can hear this, the audio is working correctly."
        : "你好，这是一段试音测试。如果你能听到这段话，说明语音播放配置正常。";
      await speak(testText, settings, draft?.language || "zh");
      setSoundTestStatus("done");
    } catch (err) {
      setSoundTestStatus("error");
      setStartError(err instanceof Error ? err.message : "试音失败");
    }
  }

  async function testMic() {
    setMicError(null);
    if (micTestStatus === "recording") {
      // 停止录音 → 回放
      micRecorderRef.current?.stop();
      return;
    }
    if (micTestStatus === "playing") {
      micAudioRef.current?.pause();
      setMicTestStatus("ok");
      return;
    }
    // 开始录音
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
      const mr = new MediaRecorder(stream, { mimeType: mime });
      micChunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) micChunksRef.current.push(e.data); };
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        micStreamRef.current = null;
        const blob = new Blob(micChunksRef.current, { type: mime });
        if (blob.size < 100) {
          setMicTestStatus("error");
          setMicError(t("setup.mic.unavailable"));
          return;
        }
        // 回放
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        micAudioRef.current = audio;
        setMicTestStatus("playing");
        audio.onended = () => { URL.revokeObjectURL(url); setMicTestStatus("ok"); };
        audio.onerror = () => { URL.revokeObjectURL(url); setMicTestStatus("ok"); };
        audio.play().catch(() => { setMicTestStatus("ok"); });
      };
      micRecorderRef.current = mr;
      mr.start();
      setMicTestStatus("recording");
    } catch (err) {
      setMicTestStatus("error");
      setMicError(err instanceof Error ? err.message : t("setup.mic.unavailable"));
    }
  }

  async function startInterview() {
    if (!draft) {
      setStartError(t("setup.missingDraft"));
      return;
    }
    if (!deviceReady) {
      setStartError(t("setup.deviceRequired"));
      return;
    }
    setStarting(true);
    setStartError(null);
    try {
      saveVoiceSettings(settings);
      if (useCouncil) {
        sessionStorage.setItem("interview-council-draft", JSON.stringify({
          ...draft,
          modelId,
          thinkingEnabled: false,
          persona,
          difficulty,
          mode,
        }));
        router.push("/interview/council");
        return;
      }

      sessionStorage.removeItem("interview-council-draft");
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...draft,
          modelId,
          thinkingEnabled: false,
          persona,
          difficulty,
          mode,
          useCouncil: false,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "创建面试失败");
      router.push(`/interview/${data.sessionId}`);
    } catch (err) {
      setStartError(err instanceof Error ? err.message : "创建面试失败");
      setStarting(false);
    }
  }

  if (!draft) {
    return (
      <div className="bg-white border rounded-md p-6 text-sm text-slate-600 space-y-4">
        <div>{t("setup.missingDraft")}</div>
        <button
          type="button"
          onClick={() => router.push("/?expanded=1")}
          className="rounded-md bg-violet-100 px-4 py-2 text-violet-800 hover:bg-violet-200"
        >
          {t("setup.backHome")}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white border rounded-md p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <div className="text-xs text-slate-500">{t("setup.completed")}</div>
            <h1 className="text-2xl font-bold">{t("setup.title")}</h1>
            <div className="text-sm text-slate-600">
              {draftSummary.join(" · ")}
            </div>
          </div>
          {headerAction && <div className="shrink-0">{headerAction}</div>}
        </div>
      </div>

      <div className="grid grid-cols-2 overflow-hidden rounded-md border bg-white text-sm">
        <button
          type="button"
          onClick={goToConfig}
          className={`px-4 py-3 text-left ${
            setupStep === "config" ? "bg-violet-100 text-violet-900" : "text-slate-600 hover:bg-slate-50"
          }`}
        >
          <div className="text-xs opacity-70">01</div>
          <div className="font-medium">{t("setup.step.config")}</div>
        </button>
        <button
          type="button"
          onClick={goToDeviceTest}
          className={`px-4 py-3 text-left ${
            setupStep === "device" ? "bg-violet-100 text-violet-900" : "text-slate-600 hover:bg-slate-50"
          }`}
        >
          <div className="text-xs opacity-70">02</div>
          <div className="font-medium">{t("setup.step.device")}</div>
        </button>
      </div>

      {setupStep === "config" ? (
        <>
          <div className="bg-white border rounded-md p-5 space-y-4">
            <div>
              <div className="mb-1 flex items-center justify-between gap-4">
                <label className="block text-sm font-medium">{t("setup.aiModel")}</label>
                <label className="flex items-center gap-2 text-xs text-slate-600">
                  <span>{t("setup.councilSwitch")}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={useCouncil}
                    onClick={() => setUseCouncil((current) => !current)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
                      useCouncil ? "bg-violet-300" : "bg-slate-300"
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${
                        useCouncil ? "translate-x-5" : "translate-x-1"
                      }`}
                    />
                  </button>
                </label>
              </div>
              <select
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                className="w-full border rounded-md p-2 text-sm"
              >
                {MODEL_OPTIONS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                    {m.note ? ` — ${t(`model.${m.id}.note`)}` : ""}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-500 mt-1">
                {t("setup.modelHint")}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">{t("setup.persona")}</label>
                <select
                  value={persona}
                  onChange={(e) => setPersona(e.target.value)}
                  className="w-full border rounded-md p-2 text-sm"
                >
                  {allowedPersonas.map((item) => (
                    <option key={item.id} value={item.id}>
                      {t(`persona.${item.id}.label`)}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-slate-500 mt-1">
                  {allowedPersonas.find((item) => item.id === persona)
                    ? t(`persona.${persona}.description`)
                    : ""}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">{t("setup.difficulty")}</label>
                <select
                  value={difficulty}
                  onChange={(e) => setDifficulty(e.target.value)}
                  className="w-full border rounded-md p-2 text-sm"
                >
                  {DIFFICULTIES.map((item) => (
                    <option key={item.id} value={item.id}>
                      {t(`difficulty.${item.id}.label`)}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-slate-500 mt-1">
                  {DIFFICULTIES.find((item) => item.id === difficulty)
                    ? t(`difficulty.${difficulty}.description`)
                    : ""}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 flex-wrap pt-2">
              <button
                type="button"
                onClick={testModel}
                disabled={testingModel}
                className="rounded-md bg-violet-100 px-4 py-2 text-sm font-medium text-violet-800 hover:bg-violet-200 disabled:opacity-50"
              >
                {testingModel ? t("setup.testing") : t("setup.testModel")}
              </button>
              {modelTestResult && (
                <span className="text-sm text-slate-600">{modelTestResult}</span>
              )}
              {modelError && <span className="text-sm text-red-600">{modelError}</span>}
            </div>
          </div>

          <VoiceSettingsPanel
            settings={settings}
            onChange={updateVoiceSettings}
            language={draft.language}
          />

          <div className="bg-white border rounded-md p-5 space-y-3">
            <label className="block text-sm font-medium">{t("setup.mode")}</label>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setMode("simulate")}
                className={`flex-1 border rounded-md p-3 text-left text-sm ${mode === "simulate" ? "border-violet-200 bg-violet-50" : "border-slate-200"}`}
              >
                <div className="font-medium">{t("setup.simulate")}</div>
                <div className="text-xs text-slate-500 mt-1">{t("setup.simulateDesc")}</div>
              </button>
              <button
                type="button"
                onClick={() => setMode("practice")}
                className={`flex-1 border rounded-md p-3 text-left text-sm ${mode === "practice" ? "border-violet-200 bg-violet-50" : "border-slate-200"}`}
              >
                <div className="font-medium">{t("setup.practice")}</div>
                <div className="text-xs text-slate-500 mt-1">{t("setup.practiceDesc")}</div>
              </button>
            </div>
          </div>

          <div className="bg-white border rounded-md p-5 flex items-center justify-between gap-4">
            <div className="text-sm text-slate-600">
              {t(mode === "simulate" ? "setup.startHint.simulate" : "setup.startHint.practice")}
            </div>
            <button
              type="button"
              onClick={goToDeviceTest}
              className="rounded-md bg-violet-100 px-5 py-2 text-sm font-medium text-violet-800 hover:bg-violet-200"
            >
              {t("setup.nextDeviceTest")}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="bg-white border rounded-md p-5 space-y-5">
            <div className="space-y-1">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                {t("setup.deviceTest")}
              </div>
              <h2 className="text-xl font-semibold text-slate-800">{t("setup.deviceTitle")}</h2>
              <p className="text-sm text-slate-600">{t("setup.deviceSubtitle")}</p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-md border border-slate-200 bg-white p-6 text-center">
                <button
                  type="button"
                  onClick={() => {
                    if (soundTestStatus === "playing") {
                      stopSpeaking();
                      setSoundTestStatus("idle");
                      return;
                    }
                    testSound();
                  }}
                  className={`mx-auto mb-4 flex h-24 w-24 items-center justify-center rounded-full border bg-white text-emerald-600 transition hover:scale-105 hover:border-emerald-300 hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 ${
                    soundTestStatus === "playing" ? "border-emerald-300 bg-emerald-50 animate-pulse" : "border-slate-200"
                  }`}
                  aria-label={
                    soundTestStatus === "done"
                      ? t("setup.sound.retry")
                      : soundTestStatus === "playing"
                        ? t("setup.stopPlay")
                      : t("setup.sound.test")
                  }
                >
                  {soundTestStatus === "done" ? <AnimatedCheckIcon /> : <SpeakerIcon />}
                </button>
                <div className="mb-3 font-medium text-slate-800">{t("setup.soundTitle")}</div>
                <div className="min-h-5 text-sm text-slate-500">
                  {soundTestStatus === "playing" && t("setup.sound.playing")}
                  {soundTestStatus === "done" && t("setup.sound.ok")}
                  {soundTestStatus === "error" && <span className="text-red-600">{t("setup.sound.error")}</span>}
                  {soundTestStatus === "idle" && t("setup.sound.test")}
                </div>
              </div>

              <div className="rounded-md border border-slate-200 bg-white p-6 text-center">
                <button
                  type="button"
                  onClick={testMic}
                  className={`mx-auto mb-4 flex h-24 w-24 items-center justify-center rounded-full border bg-white text-emerald-600 transition hover:scale-105 hover:border-emerald-300 hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 ${
                    micTestStatus === "recording" ? "border-red-300 bg-red-50 text-red-600 animate-pulse" : "border-slate-200"
                  }`}
                  aria-label={
                    micTestStatus === "recording"
                      ? t("setup.mic.stopRecord")
                      : micTestStatus === "playing"
                        ? t("setup.mic.stopPlayback")
                        : micTestStatus === "ok"
                          ? t("setup.mic.retry")
                          : t("setup.mic.test")
                  }
                >
                  {micTestStatus === "ok" ? <AnimatedCheckIcon /> : <MicIcon />}
                </button>
                <div className="mb-3 font-medium text-slate-800">{t("setup.micTitle")}</div>
                <div className="min-h-5 text-sm text-slate-500">
                  {micTestStatus === "recording" && <span className="text-red-600">{t("setup.mic.speak")}</span>}
                  {micTestStatus === "playing" && t("setup.mic.playing")}
                  {micTestStatus === "ok" && t("setup.mic.ok")}
                  {micTestStatus === "error" && <span className="text-red-600">{micError || t("setup.mic.unavailable")}</span>}
                  {micTestStatus === "idle" && t("setup.mic.test")}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white border rounded-md p-5 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="text-sm text-slate-600">
              {deviceReady
                ? t(mode === "simulate" ? "setup.startHint.simulate" : "setup.startHint.practice")
                : t("setup.deviceRequired")}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={goToConfig}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                {t("setup.backToConfig")}
              </button>
              <button
                type="button"
                onClick={startInterview}
                disabled={starting || !deviceReady}
                className="rounded-md bg-violet-100 px-5 py-2 text-sm font-medium text-violet-800 hover:bg-violet-200 disabled:opacity-50"
              >
                {starting ? t("setup.starting") : t("setup.start")}
              </button>
            </div>
          </div>
        </>
      )}

      {startError && <div className="text-sm text-red-600">{startError}</div>}
    </div>
  );
}

function SpeakerIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-11 w-11"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 9v6h4l5 4V5L8 9H4Z" />
      <path d="M16 9.5a4 4 0 0 1 0 5" />
      <path d="M18.5 7a7 7 0 0 1 0 10" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-11 w-11"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
      <path d="M9 21h6" />
    </svg>
  );
}

function AnimatedCheckIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-12 w-12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path pathLength="1" d="m8 12.4 2.7 2.7L16.5 9" strokeDasharray="1" strokeDashoffset="1">
        <animate
          attributeName="stroke-dashoffset"
          from="1"
          to="0"
          dur="0.42s"
          begin="0s"
          fill="freeze"
        />
      </path>
    </svg>
  );
}
