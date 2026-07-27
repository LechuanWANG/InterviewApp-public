"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { MODEL_OPTIONS, DEFAULT_MODEL_ID } from "@/lib/llm/models";
import { DIFFICULTIES } from "@/lib/personas";
import { GROUP_INTERVIEW_HOST_VOICE, type VoiceSettings } from "@/lib/voice/types";
import { speak, stopSpeaking } from "@/lib/voice/tts";
import { useI18n } from "./LanguageProvider";
import { LoadingDots } from "./LoadingIndicator";

const DRAFT_KEY = "interview-create-draft";

type DraftPayload = {
  resume: string;
  company: string;
  jobTitle: string;
  jd: string;
  interviewType: string;
  language: "zh" | "en";
  participantNameplate?: string;
  participantName?: string;
};

type SetupStep = "config" | "device";

export default function GroupSetupFlow({ headerAction }: { headerAction?: ReactNode }) {
  const router = useRouter();
  const { t } = useI18n();
  const [draft, setDraft] = useState<DraftPayload | null>(null);
  const [modelId, setModelId] = useState(DEFAULT_MODEL_ID);
  const [difficulty, setDifficulty] = useState("medium");
  const [useCouncil, setUseCouncil] = useState(true);
  const [setupStep, setSetupStep] = useState<SetupStep>("config");
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
    } catch {
      setDraft(null);
    }
  }, []);

  const selectedModel = useMemo(
    () => MODEL_OPTIONS.find((item) => item.id === modelId) ?? MODEL_OPTIONS[0],
    [modelId]
  );
  const draftSummary = useMemo(() => {
    if (!draft) return [];
    return [
      (draft.participantNameplate || draft.participantName || "").trim(),
      draft.company.trim(),
      draft.jobTitle.trim(),
      draft.language === "zh" ? t("setup.zhInterview") : t("setup.enInterview"),
      t("interviewChoice.group"),
    ].filter(Boolean);
  }, [draft, t]);

  const deviceReady = micTestStatus === "ok" && soundTestStatus === "done";

  const testVoiceSettings = useMemo<VoiceSettings>(
    () => ({ asr: "doubao", tts: "doubao", voice: GROUP_INTERVIEW_HOST_VOICE, autoPlay: true }),
    []
  );

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

  async function testSound() {
    setSoundTestStatus("playing");
    try {
      const testText =
        draft?.language === "en"
          ? "Hello, this is a voice test for the group interview."
          : "你好，这是群面语音的试音测试。如果你能听到这段话，说明语音播放正常。";
      await speak(testText, testVoiceSettings, draft?.language || "zh");
      setSoundTestStatus("done");
    } catch (err) {
      setSoundTestStatus("error");
      setStartError(err instanceof Error ? err.message : "试音失败");
    }
  }

  async function testMic() {
    setMicError(null);
    if (micTestStatus === "recording") {
      micRecorderRef.current?.stop();
      return;
    }
    if (micTestStatus === "playing") {
      micAudioRef.current?.pause();
      setMicTestStatus("ok");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
      const mr = new MediaRecorder(stream, { mimeType: mime });
      micChunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) micChunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        stream.getTracks().forEach((tr) => tr.stop());
        micStreamRef.current = null;
        const blob = new Blob(micChunksRef.current, { type: mime });
        if (blob.size < 100) {
          setMicTestStatus("error");
          setMicError(t("setup.mic.unavailable"));
          return;
        }
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        micAudioRef.current = audio;
        setMicTestStatus("playing");
        audio.onended = () => {
          URL.revokeObjectURL(url);
          setMicTestStatus("ok");
        };
        audio.onerror = () => {
          URL.revokeObjectURL(url);
          setMicTestStatus("ok");
        };
        audio.play().catch(() => setMicTestStatus("ok"));
      };
      micRecorderRef.current = mr;
      mr.start();
      setMicTestStatus("recording");
    } catch (err) {
      setMicTestStatus("error");
      setMicError(err instanceof Error ? err.message : t("setup.mic.unavailable"));
    }
  }

  async function startGroup() {
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
    const payload = {
      resume: draft.resume,
      participantNameplate: draft.participantNameplate,
      participantName: draft.participantName,
      company: draft.company,
      jobTitle: draft.jobTitle,
      jd: draft.jd,
      language: draft.language,
      modelId,
      difficulty,
      autoPlay: true,
      ttsEnabled: true,
    };
    try {
      if (useCouncil) {
        sessionStorage.setItem("group-council-draft", JSON.stringify(payload));
        router.push("/group/council");
        return;
      }

      sessionStorage.removeItem("group-council-draft");
      const res = await fetch("/api/group/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("groupSetup.createFailed"));
      router.push(`/group/${data.sessionId}`);
    } catch (err) {
      setStartError(err instanceof Error ? err.message : t("groupSetup.createFailed"));
      setStarting(false);
    }
  }

  if (!draft) {
    return (
      <div className="bg-white border rounded-md p-6 text-sm text-slate-600 space-y-4">
        <div>{t("setup.missingDraft")}</div>
        <button
          type="button"
          onClick={() => router.push("/interview/new")}
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
            <div className="text-xs text-slate-500">{t("interviewChoice.group")}</div>
            <h1 className="text-2xl font-bold">{t("groupSetup.title")}</h1>
            <div className="text-sm text-slate-600">{draftSummary.join(" · ")}</div>
            <p className="text-sm text-slate-500">{t("groupSetup.intro")}</p>
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
              <label className="block text-sm font-medium mb-1">{t("setup.aiModel")}</label>
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
              <p className="text-xs text-slate-500 mt-1">{t("groupSetup.modelHint", { model: selectedModel.label })}</p>
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
            </div>

            <div className="flex items-center justify-between gap-4 border-t border-slate-100 pt-4">
              <div>
                <div className="text-sm font-medium">{t("groupSetup.councilSwitch")}</div>
                <p className="text-xs text-slate-500 mt-1">
                  {useCouncil ? t("groupSetup.councilOnDesc") : t("groupSetup.councilOffDesc")}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={useCouncil}
                onClick={() => setUseCouncil((v) => !v)}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${
                  useCouncil ? "bg-violet-300" : "bg-slate-300"
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${
                    useCouncil ? "translate-x-5" : "translate-x-1"
                  }`}
                />
              </button>
            </div>
          </div>

          <div className="bg-white border rounded-md p-5 flex items-center justify-between gap-4">
            <div className="text-sm text-slate-600">{t("groupSetup.startHint")}</div>
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
                  className={`mx-auto mb-4 flex h-24 w-24 items-center justify-center rounded-full border bg-white text-emerald-600 transition hover:scale-105 hover:border-emerald-300 hover:bg-emerald-50 ${
                    soundTestStatus === "playing" ? "border-emerald-300 bg-emerald-50 animate-pulse" : "border-slate-200"
                  }`}
                >
                  {soundTestStatus === "done" ? <CheckIcon /> : <SpeakerIcon />}
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
                  className={`mx-auto mb-4 flex h-24 w-24 items-center justify-center rounded-full border bg-white text-emerald-600 transition hover:scale-105 hover:border-emerald-300 hover:bg-emerald-50 ${
                    micTestStatus === "recording" ? "border-red-300 bg-red-50 text-red-600 animate-pulse" : "border-slate-200"
                  }`}
                >
                  {micTestStatus === "ok" ? <CheckIcon /> : <MicIcon />}
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
              {deviceReady ? t("groupSetup.startHint") : t("setup.deviceRequired")}
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
                onClick={startGroup}
                disabled={starting || !deviceReady}
                className="inline-flex items-center gap-2 rounded-md bg-violet-100 px-5 py-2 text-sm font-medium text-violet-800 hover:bg-violet-200 disabled:opacity-50"
              >
                {starting ? (
                  <>
                    <LoadingDots />
                    {t("groupSetup.creating")}
                  </>
                ) : (
                  t(useCouncil ? "groupSetup.startCouncil" : "groupSetup.start")
                )}
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
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-11 w-11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9v6h4l5 4V5L8 9H4Z" />
      <path d="M16 9.5a4 4 0 0 1 0 5" />
      <path d="M18.5 7a7 7 0 0 1 0 10" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-11 w-11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
      <path d="M9 21h6" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-12 w-12" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="m8 12.4 2.7 2.7L16.5 9" />
    </svg>
  );
}
