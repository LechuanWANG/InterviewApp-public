"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "./LanguageProvider";
import VoiceRecorder, { type LiveAsrSnapshot, type VoiceRecorderHandle } from "./VoiceRecorder";
import { LIVE_CAPTION_ENABLED_KEY, LiveCaptionDock, emptyLiveCaption } from "./LiveCaptionDock";
import LoadingIndicator, { LoadingDots } from "./LoadingIndicator";
import Markdown from "./Markdown";
import { speak, stopSpeaking } from "@/lib/voice/tts";
import { GROUP_INTERVIEW_HOST_VOICE, type VoiceSettings } from "@/lib/voice/types";
import type {
  GroupDurations,
  GroupMember,
  GroupPhase,
  GroupTopic,
  GroupTurn,
  GroupTurnKind,
  GroupTurnResponse,
  ReporterKind,
} from "@/lib/groupInterview/types";

const AVATAR_BASE = "/avatars/group-interview";
const HOST_STAGE = `${AVATAR_BASE}/host_opening-and-thinking.jpg`;
const HOST_END_STAGE = `${AVATAR_BASE}/host_end.jpg`;
const USER_STAGE = `${AVATAR_BASE}/user-speaking.jpg`;
const PACING_MS = 600;
const USER_TURN_LIMIT_SEC = 180; // 用户单次发言上限：3 分钟，到点自动提交

export type GroupRoomInit = {
  id: string;
  language: "zh" | "en";
  durations: GroupDurations;
  topic: GroupTopic;
  members: GroupMember[];
  transcript: GroupTurn[];
  voice: VoiceSettings;
  phase: GroupPhase;
  reporterId: string | null;
  reporterKind: ReporterKind;
};

function avatarSrc(key: string): string {
  return `${AVATAR_BASE}/${key}.jpg`;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function GroupInterviewRoom({ init }: { init: GroupRoomInit }) {
  const router = useRouter();
  const { t } = useI18n();
  const { id, language, durations, topic, members, voice } = init;

  const students = useMemo(() => members.filter((m) => m.kind === "student"), [members]);
  const seatedMembers = useMemo(() => members.filter((m) => m.kind === "student" || m.kind === "user"), [members]);
  const ttsOn = voice.tts !== "off" && voice.autoPlay !== false;

  const [phase, setPhaseState] = useState<GroupPhase>(init.phase === "opening" ? "opening" : init.phase);
  const [transcript, setTranscript] = useState<GroupTurn[]>(init.transcript);
  const [stageSrc, setStageSrc] = useState<string>(HOST_STAGE);
  const [activeSpeakerId, setActiveSpeakerId] = useState<string | null>("host");
  const [awaitingUser, setAwaitingUser] = useState(false);
  const [userTurnKind, setUserTurnKind] = useState<GroupTurnKind>("speech");
  const [nowTick, setNowTick] = useState(Date.now());
  const [busy, setBusy] = useState(false); // AI thinking/speaking indicator
  const [error, setError] = useState<string | null>(null);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [reporterKind, setReporterKind] = useState<ReporterKind>(init.reporterKind);
  const [reportSubmitted, setReportSubmitted] = useState(
    () =>
      init.reporterKind === "user" &&
      init.transcript.some((tn) => tn.kind === "report" && tn.speakerId === "user")
  );
  const [draftText, setDraftText] = useState("");
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [liveCaptionOpen, setLiveCaptionOpen] = useState(false);
  const [liveCaption, setLiveCaption] = useState<LiveAsrSnapshot>(emptyLiveCaption());
  const [handRaisedQueued, setHandRaisedQueued] = useState(false);
  const [stageBanner, setStageBanner] = useState<GroupPhase | null>(null);

  // refs mirroring state for async loop
  const phaseRef = useRef(phase);
  const loopBusyRef = useRef(false);
  const awaitingUserRef = useRef(false);
  const raiseHandRef = useRef(false);
  const bargeInRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const skipUserPromptRef = useRef(false);
  const cancelledRef = useRef(false);
  const advancingRef = useRef(false);
  const resumedRef = useRef(false);
  const submittingRef = useRef(false);
  const turnPlaybackRef = useRef<Promise<void>>(Promise.resolve());
  const liveCaptionTextRef = useRef("");
  const draftTextRef = useRef("");
  const startingRecordingRef = useRef(false);
  const discussionEndsAtRef = useRef<number | null>(null);
  const userTurnEndsAtRef = useRef<number | null>(null);
  const thinkingEndsAtRef = useRef<number | null>(null);
  const recorderRef = useRef<VoiceRecorderHandle | null>(null);
  const prevPhaseRef = useRef<GroupPhase>(init.phase);

  const setPhase = useCallback((p: GroupPhase) => {
    phaseRef.current = p;
    setPhaseState(p);
  }, []);

  const appendTurn = useCallback((turn: GroupTurn) => {
    setTranscript((prev) => (prev.some((x) => x.index === turn.index) ? prev : [...prev, turn]));
  }, []);

  const setDraftTextValue = useCallback((text: string) => {
    draftTextRef.current = text;
    setDraftText(text);
  }, []);

  const resetLiveCaption = useCallback(() => {
    liveCaptionTextRef.current = "";
    setLiveCaption(emptyLiveCaption());
  }, []);

  const updateLiveCaption = useCallback((snapshot: LiveAsrSnapshot) => {
    const text = (snapshot.finalText || snapshot.text || snapshot.interimText || "").trim();
    liveCaptionTextRef.current = text;
    setLiveCaption(snapshot);
  }, []);

  const appendTranscript = useCallback((text: string) => {
    if (!awaitingUserRef.current && !(phaseRef.current === "reporting" && reporterKind === "user" && !reportSubmitted)) {
      return;
    }
    const next = draftTextRef.current ? `${draftTextRef.current} ${text}` : text;
    setDraftTextValue(next);
  }, [reportSubmitted, reporterKind, setDraftTextValue]);

  const toggleLiveCaption = useCallback((checked: boolean) => {
    setLiveCaptionOpen(checked);
    try {
      localStorage.setItem(LIVE_CAPTION_ENABLED_KEY, checked ? "1" : "0");
    } catch {}
  }, []);

  const stageForSpeaker = useCallback(
    (speakerId: string) => {
      if (speakerId === "user") {
        setStageSrc(USER_STAGE);
        setActiveSpeakerId("user");
        return;
      }
      if (speakerId === "host") {
        setStageSrc(HOST_STAGE);
        setActiveSpeakerId("host");
        return;
      }
      const m = members.find((x) => x.id === speakerId);
      setStageSrc(m ? avatarSrc(m.avatarKey) : HOST_STAGE);
      setActiveSpeakerId(speakerId);
    },
    [members]
  );

  const voiceSettingsFor = useCallback(
    (voiceId: string): VoiceSettings => ({
      asr: "doubao",
      tts: voice.tts === "off" ? "off" : "doubao",
      voice: voiceId,
      autoPlay: true,
    }),
    [voice.tts]
  );

  const playTurnTts = useCallback(
    async (turn: GroupTurn) => {
      await turnPlaybackRef.current;
      let releasePlayback: () => void = () => {};
      const playback = new Promise<void>((resolve) => {
        releasePlayback = resolve;
      });
      turnPlaybackRef.current = playback;
      if (!ttsOn) {
        await delay(Math.min(18000, 1800 + turn.text.length * 95));
        releasePlayback();
        return;
      }
      const voiceId =
        turn.speakerId === "host"
          ? GROUP_INTERVIEW_HOST_VOICE
          : members.find((m) => m.id === turn.speakerId)?.voice || GROUP_INTERVIEW_HOST_VOICE;
      try {
        await speak(turn.text, voiceSettingsFor(voiceId), language);
      } catch {
        // autoplay blocked or TTS error — fall back to a readable pause
        await delay(Math.min(14000, 1800 + turn.text.length * 80));
      } finally {
        releasePlayback();
      }
    },
    [ttsOn, members, voiceSettingsFor, language]
  );

  // 1s tick for countdown display
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LIVE_CAPTION_ENABLED_KEY);
      if (saved === "0") setLiveCaptionOpen(false);
      if (saved === "1") setLiveCaptionOpen(true);
    } catch {}
  }, []);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      turnPlaybackRef.current = Promise.resolve();
      stopSpeaking();
      recorderRef.current?.stopRecording();
    };
  }, []);

  const remainingDiscussionSec = useCallback(() => {
    if (!discussionEndsAtRef.current) return durations.discussSec;
    return Math.max(0, Math.round((discussionEndsAtRef.current - Date.now()) / 1000));
  }, [durations.discussSec]);

  const remainingUserTurnSec = useCallback(() => {
    if (!userTurnEndsAtRef.current) return USER_TURN_LIMIT_SEC;
    return Math.max(0, Math.round((userTurnEndsAtRef.current - Date.now()) / 1000));
  }, []);

  const remainingThinkingSec = useCallback(() => {
    if (!thinkingEndsAtRef.current) return durations.thinkSec;
    return Math.max(0, Math.round((thinkingEndsAtRef.current - Date.now()) / 1000));
  }, [durations.thinkSec]);

  // ---- core turn loop (statements + discussion) ----
  const postTurn = useCallback(
    async (raiseHand: boolean): Promise<GroupTurnResponse | null> => {
      const skipUserPrompt = skipUserPromptRef.current;
      skipUserPromptRef.current = false;
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await fetch(`/api/group/${id}/turn`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ remainingSec: remainingDiscussionSec(), raiseHand, skipUserPrompt }),
          signal: controller.signal,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "turn failed");
        return data as GroupTurnResponse;
      } catch (err) {
        // 用户抢答会中断这次生成等待；中断属预期，不报错。
        if (err instanceof Error && err.name === "AbortError") return null;
        setError(err instanceof Error ? err.message : "turn failed");
        return null;
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [id, remainingDiscussionSec]
  );

  const advance = useCallback(
    async (to: GroupPhase, extra?: Record<string, unknown>): Promise<{ turn?: GroupTurn | null } | null> => {
      try {
        const res = await fetch(`/api/group/${id}/advance`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ to, ...extra }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "advance failed");
        return data;
      } catch (err) {
        setError(err instanceof Error ? err.message : "advance failed");
        return null;
      }
    },
    [id]
  );

  const enterElecting = useCallback(async () => {
    if (
      phaseRef.current === "electing" ||
      phaseRef.current === "reporting" ||
      phaseRef.current === "finished"
    ) {
      return;
    }
    cancelledRef.current = true;
    bargeInRef.current = false;
    userTurnEndsAtRef.current = null;
    turnPlaybackRef.current = Promise.resolve();
    stopSpeaking();
    recorderRef.current?.stopRecording();
    setRecording(false);
    setTranscribing(false);
    setDraftTextValue("");
    resetLiveCaption();
    setBusy(false);
    setAwaitingUser(false);
    awaitingUserRef.current = false;
    setActiveSpeakerId("host");
    setStageSrc(HOST_STAGE);
    setPhase("electing");
    await advance("electing");
  }, [advance, setPhase]);

  // 把发言权立即交给用户（用于服务端 your_turn，以及讨论阶段的抢答插队）。
  const yieldTurnToUser = useCallback(() => {
    bargeInRef.current = false;
    raiseHandRef.current = false;
    awaitingUserRef.current = true;
    setUserTurnKind(phaseRef.current === "statements" ? "statement" : "speech");
    setAwaitingUser(true);
    setHandRaisedQueued(false);
    stageForSpeaker("user");
  }, [stageForSpeaker]);

  const runTurnLoop = useCallback(async () => {
    if (loopBusyRef.current) return;
    loopBusyRef.current = true;
    cancelledRef.current = false;
    setError(null);
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (cancelledRef.current) break;
        const p = phaseRef.current;
        if (p !== "statements" && p !== "discussion") break;
        if (p === "discussion" && remainingDiscussionSec() <= 0) {
          await enterElecting();
          break;
        }
        if (awaitingUserRef.current) break;

        // 抢答：在发起下一轮 AI 之前，立即让用户发言。
        if (bargeInRef.current) {
          yieldTurnToUser();
          break;
        }

        const raiseHand = raiseHandRef.current;
        raiseHandRef.current = false;

        setBusy(true);
        const res = await postTurn(raiseHand);
        setBusy(false);
        if (cancelledRef.current) break;

        // AI 还在思考时用户抢答 → 中断本次生成（结果已落库，计入本场），立即把麦克风给用户。
        if (bargeInRef.current) {
          yieldTurnToUser();
          break;
        }
        if (!res) break;

        if (res.kind === "phase_done") {
          setHandRaisedQueued(false);
          if (res.nextPhase === "discussion") {
            discussionEndsAtRef.current = Date.now() + durations.discussSec * 1000;
            setPhase("discussion");
            continue;
          }
          if (res.nextPhase === "electing") {
            await enterElecting();
            break;
          }
          break;
        }

        if (res.kind === "your_turn") {
          yieldTurnToUser();
          break;
        }

        // kind === "turn"
        appendTurn(res.turn);
        stageForSpeaker(res.turn.speakerId);
        await playTurnTts(res.turn);
        if (cancelledRef.current) break;
        // 说明：AI 一旦开始读题/说话就让它说完；用户的抢答（raiseHandRef）会在
        // 下一轮被服务端识别为 your_turn，从而成为「下一位」发言者，而不是打断当前发言。
        await delay(PACING_MS);
      }
    } finally {
      loopBusyRef.current = false;
    }
  }, [
    appendTurn,
    durations.discussSec,
    enterElecting,
    playTurnTts,
    postTurn,
    remainingDiscussionSec,
    setPhase,
    stageForSpeaker,
    yieldTurnToUser,
  ]);

  // discussion hard-clock: when it hits 0, force electing even if paused on user
  useEffect(() => {
    if (phase !== "discussion") return;
    if (remainingDiscussionSec() <= 0) {
      void enterElecting();
    }
  }, [phase, nowTick, remainingDiscussionSec, enterElecting]);

  useEffect(() => {
    if (phase !== "discussion") {
      setHandRaisedQueued(false);
      bargeInRef.current = false;
    }
  }, [phase]);

  // 阶段切换时弹出一个动画横幅，让用户清楚地意识到进入了下一阶段。
  useEffect(() => {
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = phase;
    if (phase === prev) return;
    const announce: GroupPhase[] = ["thinking", "statements", "discussion", "electing", "reporting"];
    if (!announce.includes(phase)) return;
    setStageBanner(phase);
    const timer = window.setTimeout(() => setStageBanner(null), 1900);
    return () => window.clearTimeout(timer);
  }, [phase]);

  // ---- phase entry actions ----
  const enterThinking = useCallback(() => {
    stopSpeaking();
    thinkingEndsAtRef.current = Date.now() + durations.thinkSec * 1000;
    setActiveSpeakerId("host");
    setStageSrc(HOST_STAGE);
    setPhase("thinking");
  }, [durations.thinkSec, setPhase]);

  const enterStatements = useCallback(async () => {
    if (phaseRef.current !== "thinking" && phaseRef.current !== "opening") return;
    if (advancingRef.current) return;
    advancingRef.current = true;
    setError(null);
    setPhase("statements"); // set phaseRef synchronously to block re-entrant auto-advance
    const ok = await advance("statements");
    advancingRef.current = false;
    if (!ok) {
      // stop the per-second auto-advance from hot-looping; let the user retry via the button
      thinkingEndsAtRef.current = null;
      setPhase("thinking");
      return;
    }
    void runTurnLoop();
  }, [advance, runTurnLoop, setPhase]);

  // auto-advance thinking → statements when countdown ends
  useEffect(() => {
    if (phase !== "thinking") return;
    if (remainingThinkingSec() <= 0) {
      void enterStatements();
    }
  }, [phase, nowTick, remainingThinkingSec, enterStatements]);

  // play HR opening on mount (opening phase)
  const openingPlayedRef = useRef(false);
  useEffect(() => {
    if (phase !== "opening" || openingPlayedRef.current) return;
    openingPlayedRef.current = true;
    cancelledRef.current = false;
    const opening = init.transcript.find((x) => x.kind === "host");
    const fallbackMs = Math.min(45000, Math.max(6000, 1800 + (opening?.text.length ?? 0) * 120));
    const fallbackTimer = window.setTimeout(() => {
      if (phaseRef.current === "opening") {
        enterThinking();
      }
    }, fallbackMs);
    void (async () => {
      if (opening) {
        stageForSpeaker("host");
        await playTurnTts(opening);
      } else {
        await delay(600);
      }
      if (phaseRef.current === "opening") {
        window.clearTimeout(fallbackTimer);
        enterThinking();
      }
    })();
    return () => window.clearTimeout(fallbackTimer);
  }, [enterThinking, phase, init.transcript, playTurnTts, stageForSpeaker]);

  // ---- user actions ----
  const startUserRecording = useCallback(async () => {
    const rec = recorderRef.current;
    if (!rec || startingRecordingRef.current || recording || submittingRef.current) return;
    startingRecordingRef.current = true;
    setError(null);
    resetLiveCaption();
    setDraftTextValue("");
    const start = await rec.startRecording();
    startingRecordingRef.current = false;
    if (start.ok) {
      userTurnEndsAtRef.current = Date.now() + USER_TURN_LIMIT_SEC * 1000;
      setRecording(true);
      return;
    }
    setError(start.error || t("group.recorderNotReady"));
  }, [recording, resetLiveCaption, setDraftTextValue, t]);

  useEffect(() => {
    if (!awaitingUser && !(phase === "reporting" && reporterKind === "user" && !reportSubmitted)) return;
    void startUserRecording();
  }, [awaitingUser, phase, reporterKind, reportSubmitted, startUserRecording]);

  const stopUserRecordingForSubmit = useCallback(async () => {
    const rec = recorderRef.current;
    const liveText = liveCaptionTextRef.current.trim();
    if (!rec || !recording) return { ok: true as const, text: liveText || draftTextRef.current.trim() };
    setRecording(false);
    if (!liveText) setTranscribing(true);
    const result = liveText
      ? await rec.stopAndUseLiveTranscript()
      : await rec.stopAndWaitForTranscript();
    setTranscribing(false);
    if (!result.ok) return result;
    const text = (result.text || liveText || draftTextRef.current).trim();
    if (text) setDraftTextValue(text);
    return { ok: true as const, text };
  }, [recording, setDraftTextValue]);

  const submitUserTurn = useCallback(async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    userTurnEndsAtRef.current = null;
    const stopped = await stopUserRecordingForSubmit();
    if (!stopped.ok) {
      setError(stopped.error || t("group.transcribeFailed"));
      submittingRef.current = false;
      return;
    }
    const recognizedText = (stopped.text || draftTextRef.current || liveCaptionTextRef.current).trim();
    const kind = userTurnKind;
    const text = recognizedText || t("group.noRecognizedSpeech");
    setBusy(true);
    try {
      const res = await fetch(`/api/group/${id}/speak`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, kind }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "speak failed");
      appendTurn(data.turn as GroupTurn);
      setDraftTextValue("");
      resetLiveCaption();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "speak failed");
      setBusy(false);
      submittingRef.current = false;
      return;
    }
    setBusy(false);
    submittingRef.current = false;

    if (kind === "report") {
      // user finished the final report → ready to generate assessment
      setAwaitingUser(false);
      awaitingUserRef.current = false;
      setReportSubmitted(true);
      return;
    }

    awaitingUserRef.current = false;
    setAwaitingUser(false);
    void runTurnLoop();
  }, [appendTurn, id, resetLiveCaption, runTurnLoop, setDraftTextValue, stopUserRecordingForSubmit, t, userTurnKind]);

  // 用户发言 3 分钟倒计时到点：自动提交当前发言。
  useEffect(() => {
    if (!recording || !userTurnEndsAtRef.current) return;
    if (remainingUserTurnSec() <= 0 && !submittingRef.current) {
      void submitUserTurn();
    }
  }, [nowTick, recording, remainingUserTurnSec, submitUserTurn]);

  const raiseHand = useCallback(() => {
    if (phaseRef.current !== "discussion" || awaitingUserRef.current) return;
    raiseHandRef.current = true;
    setHandRaisedQueued(true);
    setError(null);
    // abortRef 非空 = AI 还在「思考/生成」这轮发言 → 立即插队：取消等待，马上让用户说。
    // abortRef 为空 = AI 已经在读题/说话（或空闲）→ 不打断，用户作为下一位发言。
    const inFlight = abortRef.current;
    if (inFlight) {
      bargeInRef.current = true;
      inFlight.abort();
    }
    void runTurnLoop(); // 若循环空闲（卡顿后）则重启；否则正在运行的循环会就近处理抢答
  }, [runTurnLoop]);

  const skipOpening = useCallback(() => {
    cancelledRef.current = false;
    stopSpeaking();
    enterThinking();
  }, [enterThinking]);

  // resume the discussion/statements loop after a reload or a stall
  useEffect(() => {
    if (resumedRef.current) return;
    if (init.phase !== "statements" && init.phase !== "discussion") return;
    resumedRef.current = true;
    if (init.phase === "discussion" && discussionEndsAtRef.current === null) {
      discussionEndsAtRef.current = Date.now() + durations.discussSec * 1000;
    }
    void runTurnLoop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- electing / reporting ----
  const chooseReporter = useCallback(
    async (kind: ReporterKind) => {
      if (kind === "user") {
        const ok = await advance("reporting", { reporterKind: "user", reporterId: "user" });
        if (!ok) return;
        setReporterKind("user");
        setUserTurnKind("report");
        setPhase("reporting");
        stageForSpeaker("user");
        return;
      }
      // AI reporter — prefer synthesizer/leader
      const reporter =
        students.find((s) => s.persona === "synthesizer") ??
        students.find((s) => s.persona === "leader") ??
        students[0];
      setBusy(true);
      const res = await advance("reporting", {
        reporterKind: "ai",
        reporterId: reporter?.id ?? null,
      });
      setBusy(false);
      if (!res) return;
      setReporterKind("ai");
      setPhase("reporting");
      if (res.turn) {
        appendTurn(res.turn);
        stageForSpeaker(res.turn.speakerId);
        await playTurnTts(res.turn);
      }
      setReportSubmitted(true);
    },
    [advance, appendTurn, playTurnTts, setPhase, stageForSpeaker, students]
  );

  const generateReport = useCallback(async () => {
    setGeneratingReport(true);
    setError(null);
    try {
      const res = await fetch(`/api/group/${id}/report`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "report failed");
      setStageSrc(HOST_END_STAGE);
      router.push(`/group/${id}/report`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "report failed");
      setGeneratingReport(false);
    }
  }, [id, router]);

  // ---- derived display ----
  const phaseLabel = t(`group.phase.${phase}`);
  const countdown =
    phase === "thinking"
      ? remainingThinkingSec()
      : phase === "discussion"
        ? remainingDiscussionSec()
        : null;
  const countdownLabel = countdown !== null ? `${Math.floor(countdown / 60)}:${String(countdown % 60).padStart(2, "0")}` : null;
  const currentTranscriptTurn = useMemo(() => {
    if (!activeSpeakerId || activeSpeakerId === "user") return null;
    for (let i = transcript.length - 1; i >= 0; i -= 1) {
      if (transcript[i].speakerId === activeSpeakerId) return transcript[i];
    }
    return null;
  }, [activeSpeakerId, transcript]);

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      {stageBanner && (
        <div className="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center px-4">
          <div
            key={stageBanner}
            className="group-phase-banner flex flex-col items-center gap-2 rounded-3xl border border-white/60 bg-gradient-to-br from-violet-600 to-indigo-600 px-10 py-7 text-center text-white shadow-2xl shadow-violet-900/30"
          >
            <div className="text-xs font-semibold uppercase tracking-[0.32em] text-violet-100">
              {t("group.transitionKicker")}
            </div>
            <div className="text-3xl font-semibold">{t(`group.phase.${stageBanner}`)}</div>
          </div>
        </div>
      )}
      <div className="sticky top-3 z-40 mb-4 rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-lg backdrop-blur-md">
        <div className="min-w-0">
          <div className="truncate text-xs text-slate-500">
            {t("interviewChoice.group")} · {phaseLabel}
          </div>
          <div className="mt-1 break-words text-base font-semibold leading-6 text-slate-900">{topic.title}</div>
        </div>
      </div>

      {/* phase bar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <PhaseBar current={phase} t={t} />
        {countdownLabel && phase !== "thinking" && (
          <div
            className={`rounded-md px-3 py-1 text-sm font-semibold ${
              countdown !== null && countdown <= 30 ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-700"
            }`}
          >
            {phaseLabel} · {countdownLabel}
          </div>
        )}
      </div>

      {/* topic card */}
      <details className="mb-4 rounded-md border bg-white p-4" open={phase === "opening" || phase === "thinking"}>
        <summary className="cursor-pointer text-sm font-medium text-slate-800">{t("group.topicTitle")}</summary>
        <div className="mt-2 text-sm text-slate-700">
          <div className="font-semibold">{topic.title}</div>
          <Markdown content={topic.background} className="mt-1 space-y-2 text-sm leading-6 text-slate-600" />
        </div>
      </details>

      {phase === "thinking" && countdownLabel && countdown !== null && (
        <div className="mb-4 rounded-md border border-violet-200 bg-violet-50 px-5 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase text-violet-700">{t("group.readingCountdown")}</div>
              <div className="mt-1 text-sm text-slate-600">{t("group.aiThinkingDuringReading")}</div>
            </div>
            <div className={`tabular-nums text-5xl font-semibold leading-none ${
              countdown <= 30 ? "text-red-600" : "text-violet-700"
            }`}>
              {countdownLabel}
            </div>
          </div>
        </div>
      )}

      {/* center stage */}
      <div className="mb-3 flex flex-col items-center">
        <div className="relative h-64 w-full max-w-md overflow-hidden rounded-xl bg-slate-50">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={stageSrc}
            alt="stage"
            loading="eager"
            className="h-full w-full object-contain transition-opacity duration-500"
          />
        </div>
        {busy && (
          <div className="mt-2">
            <SlowThinkingDots label={t("group.thinking")} />
          </div>
        )}
      </div>

      {/* seats row */}
      <div className="mb-4 flex items-center justify-center gap-3">
        {seatedMembers.map((member) => (
          <SeatAvatar
            key={member.id}
            member={member}
            active={activeSpeakerId === member.id}
            t={t}
          />
        ))}
      </div>

      {/* current transcript only */}
      <CurrentTranscriptPanel
        turn={currentTranscriptTurn}
        activeSpeakerId={activeSpeakerId}
        thinking={phase === "thinking" || busy}
        t={t}
      />

      {error && <div className="mb-3 text-sm text-red-600">{error}</div>}

      {/* phase-specific controls */}
      {phase === "opening" && (
        <div className="rounded-md border bg-white p-4 text-center">
          <p className="mb-3 text-sm text-slate-600">{t("group.openingAutoHint")}</p>
          <button
            type="button"
            onClick={skipOpening}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            {t("group.skipOpening")}
          </button>
        </div>
      )}

      {phase === "thinking" && (
        <div className="rounded-md border bg-white p-4 text-center">
          <p className="mb-3 text-sm text-slate-600">{t("group.thinkingHint")}</p>
          <button
            type="button"
            onClick={() => void enterStatements()}
            className="rounded-md bg-violet-600 px-5 py-2 text-sm font-medium text-white hover:bg-violet-700"
          >
            {t("group.skipThinking")}
          </button>
        </div>
      )}

      {(phase === "statements" || phase === "discussion") && (
        <div className="rounded-md border bg-white p-4">
          {awaitingUser ? (
            <UserTurnPanel
              kind={userTurnKind}
              t={t}
              transcribing={transcribing}
              busy={busy}
              recording={recording}
              secLeft={remainingUserTurnSec()}
              totalSec={USER_TURN_LIMIT_SEC}
              onStopRecording={submitUserTurn}
            />
          ) : (
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm text-slate-500">
                {phase === "discussion"
                  ? handRaisedQueued
                    ? t("group.raiseHandQueued")
                    : t("group.discussionOngoing")
                  : t("group.statementsOngoing")}
              </div>
              <div className="flex items-center gap-2">
                {error && (
                  <button
                    type="button"
                    onClick={() => void runTurnLoop()}
                    className="rounded-md bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
                  >
                    {t("group.continue")}
                  </button>
                )}
                {phase === "discussion" && (
                  <button
                    type="button"
                    onClick={raiseHand}
                    disabled={handRaisedQueued}
                    className="rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600"
                  >
                    {t("group.raiseHand")}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {phase === "electing" && (
        <div className="rounded-md border bg-white p-4 text-center">
          <p className="mb-4 text-sm text-slate-700">{t("group.electingHint")}</p>
          <div className="flex flex-wrap justify-center gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => void chooseReporter("user")}
              className="rounded-md bg-violet-600 px-5 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
            >
              {t("group.reportMyself")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void chooseReporter("ai")}
              className="rounded-md border border-slate-300 bg-white px-5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {t("group.reportByAi")}
            </button>
          </div>
        </div>
      )}

      {phase === "reporting" && (
        <div className="rounded-md border bg-white p-4">
          {reporterKind === "user" && !reportSubmitted ? (
            <UserTurnPanel
              kind="report"
              t={t}
              transcribing={transcribing}
              busy={busy}
              recording={recording}
              secLeft={remainingUserTurnSec()}
              totalSec={USER_TURN_LIMIT_SEC}
              onStopRecording={submitUserTurn}
            />
          ) : (
            <div className="text-center">
              <p className="mb-3 text-sm text-slate-600">{t("group.reportingDone")}</p>
              <button
                type="button"
                onClick={() => void generateReport()}
                disabled={generatingReport}
                className="inline-flex items-center gap-2 rounded-md bg-violet-600 px-5 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
              >
                {generatingReport ? (
                  <>
                    <LoadingDots />
                    {t("group.generatingReport")}
                  </>
                ) : (
                  t("group.viewReport")
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {/* recorder always mounted (hidden) so ASR promise survives */}
      <div className="hidden">
        <VoiceRecorder
          ref={recorderRef}
          asr="doubao"
          language={language}
          hideControls
          liveTranscriptionEnabled
          onLiveTranscript={updateLiveCaption}
          onTranscript={appendTranscript}
        />
      </div>

      <LiveCaptionDock
        open={liveCaptionOpen}
        snapshot={liveCaption}
        onOpenChange={toggleLiveCaption}
      />
    </main>
  );
}

function PhaseBar({ current, t }: { current: GroupPhase; t: (k: string) => string }) {
  const steps: GroupPhase[] = ["opening", "thinking", "statements", "discussion", "reporting"];
  const idx = steps.indexOf(current === "electing" || current === "wrapup" ? "discussion" : current === "finished" ? "reporting" : current);
  return (
    <div className="flex items-center gap-1 text-xs">
      {steps.map((s, i) => (
        <div key={s} className="flex items-center gap-1">
          <span
            className={`rounded px-2 py-1 ${
              i <= idx ? "bg-violet-100 text-violet-800" : "bg-slate-100 text-slate-400"
            }`}
          >
            {t(`group.phase.${s}`)}
          </span>
          {i < steps.length - 1 && <span className="text-slate-300">›</span>}
        </div>
      ))}
    </div>
  );
}

function SlowThinkingDots({ label }: { label: string }) {
  return (
    <span
      role="status"
      aria-live="polite"
      className="inline-flex items-center gap-2 rounded-full bg-slate-50 px-3 py-1.5 text-sm font-medium text-slate-500"
    >
      <span>{label}</span>
      <span className="inline-flex items-center gap-1 text-violet-500" aria-hidden="true">
        <span className="h-1.5 w-1.5 animate-[group-thinking-dot_1.8s_ease-in-out_infinite] rounded-full bg-current opacity-30" />
        <span className="h-1.5 w-1.5 animate-[group-thinking-dot_1.8s_ease-in-out_0.3s_infinite] rounded-full bg-current opacity-30" />
        <span className="h-1.5 w-1.5 animate-[group-thinking-dot_1.8s_ease-in-out_0.6s_infinite] rounded-full bg-current opacity-30" />
      </span>
    </span>
  );
}

function CurrentTranscriptPanel({
  turn,
  activeSpeakerId,
  thinking,
  t,
}: {
  turn: GroupTurn | null;
  activeSpeakerId: string | null;
  thinking: boolean;
  t: (k: string) => string;
}) {
  if (!turn) {
    return (
      <div className="mb-4 rounded-md border bg-white p-4 text-sm text-slate-500">
        {thinking
          ? t("group.currentTranscriptThinking")
          : activeSpeakerId === "user"
            ? t("group.currentTranscriptUser")
            : t("group.currentTranscriptEmpty")}
      </div>
    );
  }
  const isUser = turn.speakerId === "user";
  const kindLabel =
    turn.kind === "host"
      ? "HR"
      : turn.kind === "statement"
        ? t("group.kind.statement")
        : turn.kind === "report"
          ? t("group.kind.report")
          : "";
  return (
    <div className="mb-4 rounded-md border bg-white p-4">
      <div className={`rounded-lg px-3 py-2 text-sm ${isUser ? "bg-violet-600 text-white" : "bg-slate-100 text-slate-800"}`}>
        <div className={`mb-1 text-xs ${isUser ? "text-violet-100" : "text-slate-500"}`}>
          {turn.speakerName}
          {kindLabel ? ` · ${kindLabel}` : ""}
        </div>
        <div className="whitespace-pre-line leading-6">{turn.text}</div>
      </div>
    </div>
  );
}

function SeatAvatar({
  member,
  active,
  t,
}: {
  member: GroupMember;
  active: boolean;
  t: (k: string) => string;
}) {
  const isUser = member.kind === "user";
  return (
    <div className="flex flex-col items-center">
      <div
        className={`flex h-14 w-14 items-center justify-center overflow-hidden rounded-full border-2 transition ${
          active ? "border-violet-500 ring-2 ring-violet-200" : "border-slate-200 opacity-70"
        } ${isUser ? "bg-violet-600 text-sm font-semibold text-white" : ""}`}
      >
        {isUser ? (
          <span>{t("group.you")}</span>
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={avatarSrc(member.avatarKey)}
            alt={member.name}
            className="h-full w-full object-cover"
          />
        )}
      </div>
      <span className="mt-1 max-w-24 truncate text-xs text-slate-600">
        {isUser ? userSeatLabel(member.name, t("group.you")) : member.name}
      </span>
    </div>
  );
}

function userSeatLabel(memberName: string, youLabel: string): string {
  const name = memberName.trim();
  if (!name || name === youLabel || name === "You" || name === "你") return youLabel;
  return `${youLabel} · ${name}`;
}

function UserTurnPanel({
  kind,
  t,
  transcribing,
  busy,
  recording,
  secLeft,
  totalSec,
  onStopRecording,
}: {
  kind: GroupTurnKind;
  t: (k: string) => string;
  transcribing: boolean;
  busy: boolean;
  recording: boolean;
  secLeft: number;
  totalSec: number;
  onStopRecording: () => void;
}) {
  const prompt =
    kind === "statement"
      ? t("group.yourStatement")
      : kind === "report"
        ? t("group.yourReport")
        : t("group.yourTurn");
  const pct = Math.max(0, Math.min(100, (secLeft / Math.max(totalSec, 1)) * 100));
  const lowTime = secLeft <= 30;
  const countdownLabel = `${Math.floor(secLeft / 60)}:${String(secLeft % 60).padStart(2, "0")}`;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-medium text-violet-700">{prompt}</div>
        <div className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium ${
          transcribing ? "bg-slate-100 text-slate-600" : "bg-red-50 text-red-600"
        }`}>
          <span className={`h-2 w-2 rounded-full ${transcribing ? "bg-slate-400" : "animate-pulse bg-red-500"}`} />
          {transcribing ? t("group.transcribing") : t("group.listening")}
        </div>
      </div>

      {/* 发言倒计时（3 分钟，参考一对一面试） */}
      {recording && (
        <div>
          <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
            <span>{t("group.speakingCountdown")}</span>
            <span className={`tabular-nums ${lowTime ? "font-semibold text-red-600" : ""}`}>{countdownLabel}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full transition-all ${lowTime ? "bg-red-500" : "bg-violet-500"}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {transcribing ? (
        <div className="flex justify-center py-4">
          <LoadingIndicator variant="inline" label={t("group.transcribing")} />
        </div>
      ) : busy ? (
        <div className="flex justify-center py-4">
          <SlowThinkingDots label={t("group.submittingSpeech")} />
        </div>
      ) : (
        <div className="flex items-center justify-center py-2">
          <button
            type="button"
            onClick={onStopRecording}
            className="rounded-md bg-slate-900 px-6 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            {t("group.stopRecording")}
          </button>
        </div>
      )}
    </div>
  );
}
