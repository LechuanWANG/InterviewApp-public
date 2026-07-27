"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { createBrowserAsr, isBrowserAsrSupported } from "@/lib/voice/browserAsr";
import { blobToWav } from "@/lib/voice/audioToWav";
import {
  startLiveDoubaoAsr,
  type LiveAsrController,
  type LiveAsrSnapshot,
} from "@/lib/voice/liveDoubaoAsrClient";
import type { AsrMethod } from "@/lib/voice/types";
import { useI18n } from "./LanguageProvider";

export type { LiveAsrSnapshot } from "@/lib/voice/liveDoubaoAsrClient";

export type VoiceRecorderHandle = {
  startRecording: () => Promise<RecordingStartResult>;
  stopRecording: () => void;
  stopAndWaitForTranscript: () => Promise<TranscriptionResult>;
  stopAndUseLiveTranscript: () => Promise<TranscriptionResult>;
  retryLastTranscription: () => Promise<TranscriptionResult>;
  isRecording: boolean;
};

export type RecordingStartResult =
  | { ok: true }
  | { ok: false; error: string };

export type TranscriptionResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

const MIN_SERVER_ASR_AUDIO_BYTES = 1024;
const SERVER_ASR_MAX_ATTEMPTS = 2;
const SERVER_ASR_REQUEST_TIMEOUT_MS = 70000;

const VoiceRecorder = forwardRef<
  VoiceRecorderHandle,
  {
    asr: AsrMethod;
    language: "zh" | "en";
    onTranscript: (text: string) => void;
    onRecordingStart?: () => void;
    onRecordingStop?: () => void;
    liveTranscriptionEnabled?: boolean;
    onLiveTranscript?: (snapshot: LiveAsrSnapshot) => void;
    disabled?: boolean;
    hideControls?: boolean;
  }
>(function VoiceRecorder(
  {
    asr,
    language,
    onTranscript,
    onRecordingStart,
    onRecordingStop,
    liveTranscriptionEnabled,
    onLiveTranscript,
    disabled,
    hideControls,
  },
  ref
) {
  const { t } = useI18n();
  const [recording, setRecording] = useState(false);
  const [interim, setInterim] = useState("");
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recognitionRef = useRef<ReturnType<typeof createBrowserAsr> | null>(null);
  const finalTextRef = useRef("");
  const streamRef = useRef<MediaStream | null>(null);
  const liveAsrRef = useRef<LiveAsrController | null>(null);
  const liveSnapshotRef = useRef<LiveAsrSnapshot>(emptyLiveSnapshot());
  const transcribePromiseRef = useRef<Promise<TranscriptionResult> | null>(null);
  const stopWaitPromiseRef = useRef<Promise<TranscriptionResult> | null>(null);
  const stopResolverRef = useRef<((result: TranscriptionResult) => void) | null>(null);
  const suppressServerTranscribeRef = useRef(false);
  const recordingSeqRef = useRef(0);
  const lastServerAudioRef = useRef<{ blob: Blob; mime: string } | null>(null);

  useEffect(() => () => {
    stopLiveTranscription("close");
    stopStream();
  }, []);

  useEffect(() => {
    if (!recording || asr !== "doubao") return;
    if (liveTranscriptionEnabled) {
      if (streamRef.current && !liveAsrRef.current) {
        startLiveTranscription(streamRef.current, recordingSeqRef.current);
      }
    } else if (liveAsrRef.current) {
      stopLiveTranscription("close");
    }
  }, [asr, language, liveTranscriptionEnabled, recording]);

  useImperativeHandle(ref, () => ({
    startRecording: start,
    stopRecording: stop,
    stopAndWaitForTranscript: stopAndWaitForTranscriptInternal,
    stopAndUseLiveTranscript: stopAndUseLiveTranscriptInternal,
    retryLastTranscription: async () => {
      const saved = lastServerAudioRef.current;
      if (!saved) {
        return { ok: false, error: "没有可重试的录音，请重新录制。" };
      }
      const recordingSeq = ++recordingSeqRef.current;
      const promise = transcribeServer(saved.blob, saved.mime, recordingSeq);
      transcribePromiseRef.current = promise;
      return promise;
    },
    get isRecording() { return recording; },
  }));

  function createStopWaiter() {
    if (stopWaitPromiseRef.current) return stopWaitPromiseRef.current;
    const p = new Promise<TranscriptionResult>((resolve) => {
      stopResolverRef.current = resolve;
      // 长录音转码和线上 ASR 都可能慢，但不能无限卡住。
      setTimeout(() => {
        if (stopResolverRef.current === resolve) {
          recordingSeqRef.current += 1;
          const result: TranscriptionResult = {
            ok: false,
            error: "语音识别超时，本次录音已保留。你可以手动输入回答后继续。",
          };
          stopResolverRef.current = null;
          stopWaitPromiseRef.current = null;
          resolve(result);
        }
      }, 90000);
    });
    stopWaitPromiseRef.current = p;
    return p;
  }

  function resolveStopWaiter(result: TranscriptionResult) {
    if (stopResolverRef.current) {
      stopResolverRef.current(result);
      stopResolverRef.current = null;
      stopWaitPromiseRef.current = null;
    }
  }

  function stopStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  function updateLiveSnapshot(snapshot: LiveAsrSnapshot) {
    liveSnapshotRef.current = snapshot;
    onLiveTranscript?.(snapshot);
  }

  function stopAndWaitForTranscriptInternal(): Promise<TranscriptionResult> {
    if (asr === "browser") {
      return Promise.resolve(stopBrowserAsr());
    }
    const mr = mediaRecorderRef.current;
    if (transcribePromiseRef.current) {
      return transcribePromiseRef.current;
    }
    if (stopWaitPromiseRef.current) {
      return stopWaitPromiseRef.current;
    }
    if (!mr) {
      return Promise.resolve({ ok: false, error: "录音尚未开始，请重新录制。" });
    }
    if (mr.state !== "recording") {
      return Promise.resolve({ ok: false, error: "语音识别仍在准备中，请稍后重试。" });
    }
    const p = createStopWaiter();
    mr.stop();
    setRecording(false);
    return p;
  }

  function stopAndUseLiveTranscriptInternal(): Promise<TranscriptionResult> {
    if (asr === "browser") {
      return Promise.resolve(stopBrowserAsr());
    }
    const mr = mediaRecorderRef.current;
    if (transcribePromiseRef.current) {
      return transcribePromiseRef.current;
    }
    if (stopWaitPromiseRef.current) {
      return stopWaitPromiseRef.current;
    }
    if (!mr) {
      return Promise.resolve({ ok: false, error: "录音尚未开始，请重新录制。" });
    }
    if (mr.state !== "recording") {
      return Promise.resolve({ ok: false, error: "语音识别仍在准备中，请稍后重试。" });
    }

    const liveText = liveTranscriptText();
    if (!liveText) {
      return stopAndWaitForTranscriptInternal();
    }

    suppressServerTranscribeRef.current = true;
    transcribePromiseRef.current = null;
    stopWaitPromiseRef.current = null;
    stopResolverRef.current = null;
    onTranscript(liveText);
    stopLiveTranscription("finish");
    mr.stop();
    setRecording(false);
    onRecordingStop?.();
    return Promise.resolve({ ok: true, text: liveText });
  }

  function startLiveTranscription(stream: MediaStream, recordingSeq: number) {
    if (asr !== "doubao" || !liveTranscriptionEnabled || liveAsrRef.current) return;
    try {
      const controller = startLiveDoubaoAsr({
        stream,
        language,
        onUpdate: (snapshot) => {
          if (recordingSeq !== recordingSeqRef.current) return;
          liveSnapshotRef.current = snapshot;
          onLiveTranscript?.(snapshot);
        },
      });
      liveAsrRef.current = controller;
    } catch (err) {
      updateLiveSnapshot({
        ...liveSnapshotRef.current,
        status: "error",
        error: err instanceof Error ? err.message : "实时识别启动失败",
      });
    }
  }

  function stopLiveTranscription(mode: "finish" | "close") {
    const controller = liveAsrRef.current;
    liveAsrRef.current = null;
    if (!controller) return;
    if (mode === "finish") controller.stop();
    else controller.close();
  }

  function liveTranscriptText(): string {
    const snapshot = liveSnapshotRef.current;
    return (snapshot.finalText || snapshot.text || snapshot.interimText || "").trim();
  }

  async function start(): Promise<RecordingStartResult> {
    setError(null);
    setInterim("");
    finalTextRef.current = "";
    updateLiveSnapshot(emptyLiveSnapshot());
    transcribePromiseRef.current = null;
    stopWaitPromiseRef.current = null;
    stopResolverRef.current = null;
    suppressServerTranscribeRef.current = false;
    const recordingSeq = ++recordingSeqRef.current;

    if (asr === "browser") {
      if (!isBrowserAsrSupported()) {
        const message = "当前浏览器不支持语音识别，请切换到豆包 ASR 或 Whisper";
        setError(message);
        return { ok: false, error: message };
      }
      try {
        const r = createBrowserAsr(language === "zh" ? "zh-CN" : "en-US");
        recognitionRef.current = r;
        r.onresult = (e: { results: { 0: { transcript: string }; isFinal?: boolean }[] }) => {
          let interimText = "";
          let finalText = "";
          for (let i = 0; i < e.results.length; i++) {
            const res = e.results[i];
            const text = res[0].transcript;
            if (res.isFinal) finalText += text;
            else interimText += text;
          }
          if (finalText) finalTextRef.current += finalText;
          setInterim(interimText);
        };
        r.onerror = (ev: { error: string }) => {
          setError("识别错误：" + ev.error);
          setRecording(false);
          onRecordingStop?.();
        };
        r.onend = () => {
          setRecording(false);
          onRecordingStop?.();
        };
        r.start();
        setRecording(true);
        onRecordingStart?.();
        return { ok: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : "启动失败";
        setError(message);
        return { ok: false, error: message };
      }
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      if (asr === "doubao" && liveTranscriptionEnabled) {
        startLiveTranscription(stream, recordingSeq);
      }
      const mime =
        MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
      const mr = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = async () => {
        stopLiveTranscription("finish");
        stopStream();
        const blob = new Blob(chunksRef.current, { type: mime });
        lastServerAudioRef.current = { blob, mime };
        if (suppressServerTranscribeRef.current) {
          suppressServerTranscribeRef.current = false;
          return;
        }
        if (blob.size < MIN_SERVER_ASR_AUDIO_BYTES) {
          const result: TranscriptionResult = {
            ok: false,
            error: "录音太短或没有录到有效声音，请重新录制。",
          };
          setError(result.error);
          resolveStopWaiter(result);
          return;
        }
        const promise = transcribeServer(blob, mime, recordingSeq);
        transcribePromiseRef.current = promise;
        const result = await promise;
        resolveStopWaiter(result);
      };
      mediaRecorderRef.current = mr;
      mr.start();
      setRecording(true);
      onRecordingStart?.();
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? "无法访问麦克风：" + err.message : "麦克风访问失败";
      setError(message);
      return { ok: false, error: message };
    }
  }

  async function transcribeServer(blob: Blob, mime: string, recordingSeq: number): Promise<TranscriptionResult> {
    setProcessing(true);
    const t0 = Date.now();
    console.log(`[ASR] 开始处理，音频大小 ${(blob.size / 1024).toFixed(1)}KB, 格式 ${mime}`);
    try {
      let provider: "doubao" | "whisper";
      let file: File;
      const extraFields: Record<string, string> = {};

      if (asr === "doubao") {
        const wav = await blobToWav(blob, 16000);
        console.log(`[ASR] WAV 转码完成，耗时 ${Date.now() - t0}ms，大小 ${(wav.size / 1024).toFixed(1)}KB`);
        file = new File([wav], "audio.wav", { type: "audio/wav" });
        provider = "doubao";
        extraFields.sampleRate = "16000";
      } else {
        const ext = mime.includes("webm") ? "webm" : "mp4";
        file = new File([blob], `audio.${ext}`, { type: mime });
        provider = "whisper";
      }

      let lastError: Error | null = null;
      const maxAttempts = provider === "doubao" ? SERVER_ASR_MAX_ATTEMPTS : 1;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const form = new FormData();
        form.append("file", file);
        form.append("provider", provider);
        form.append("language", language);
        form.append("attempt", String(attempt));
        Object.entries(extraFields).forEach(([key, value]) => form.append(key, value));

        try {
          const res = await fetchWithTimeout(
            "/api/transcribe",
            { method: "POST", body: form },
            SERVER_ASR_REQUEST_TIMEOUT_MS
          );
          const raw = await res.text();
          const data = parseJsonObject(raw);
          console.log(`[ASR] 服务端返回，第 ${attempt}/${maxAttempts} 次，总耗时 ${Date.now() - t0}ms，结果: ${JSON.stringify(data).slice(0, 200)}`);
          if (!res.ok) {
            throw new Error(extractErrorMessage(data) || raw.slice(0, 300) || "转写失败");
          }
          const text = typeof data.text === "string" ? data.text.trim() : "";
          if (text && recordingSeq === recordingSeqRef.current) onTranscript(text);
          return { ok: true, text };
        } catch (err) {
          lastError = err instanceof Error ? err : new Error("转写失败");
          console.warn(`[ASR] 第 ${attempt}/${maxAttempts} 次失败`, lastError);
          if (attempt < maxAttempts) {
            await new Promise((resolve) => setTimeout(resolve, 700 * attempt));
          }
        }
      }
      throw lastError || new Error("转写失败");
    } catch (err) {
      console.error(`[ASR] 失败，耗时 ${Date.now() - t0}ms`, err);
      const liveText = liveTranscriptText();
      if (liveText && recordingSeq === recordingSeqRef.current) {
        onTranscript(liveText);
        return { ok: true, text: liveText };
      }
      const detail = err instanceof Error ? err.message : "转写失败";
      const message = `${detail}。本次录音已保留，你可以手动输入回答后继续。`;
      setError(message);
      return { ok: false, error: message };
    } finally {
      setProcessing(false);
    }
  }

  function stopBrowserAsr(): TranscriptionResult {
    recognitionRef.current?.stop();
    setRecording(false);
    const full = (finalTextRef.current + interim).trim();
    if (full) onTranscript(full);
    setInterim("");
    onRecordingStop?.();
    return { ok: true, text: full };
  }

  function stop() {
    if (asr === "browser") {
      stopBrowserAsr();
      return;
    }
    const mr = mediaRecorderRef.current;
    if (mr?.state === "recording") {
      createStopWaiter();
      mr.stop();
    }
    setRecording(false);
    onRecordingStop?.();
  }

  if (hideControls) {
    return (
      <div className="space-y-1">
        {recording && (
          <div className="flex items-center gap-2 text-sm text-red-600 animate-pulse">
            <span className="inline-block w-2 h-2 bg-red-600 rounded-full" />
            {t("recorder.recording")}
          </div>
        )}
        {processing && (
          <div className="text-xs text-slate-500">
            {asr === "doubao" ? t("recorder.doubaoProcessing") : t("recorder.whisperProcessing")}
          </div>
        )}
        {interim && <div className="text-xs text-slate-500 italic">{t("recorder.recognizing", { text: interim })}</div>}
        {error && <div className="text-xs text-red-600">{error}</div>}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        {!recording ? (
          <button
            type="button"
            onClick={start}
            disabled={disabled || processing}
            className="bg-red-600 text-white rounded-md px-4 py-2 text-sm disabled:opacity-50"
          >
            {t("recorder.start")}
          </button>
        ) : (
          <button
            type="button"
            onClick={stop}
            className="bg-slate-900 text-white rounded-md px-4 py-2 text-sm animate-pulse"
          >
            {t("recorder.stop")}
          </button>
        )}
        {processing && (
          <span className="text-xs text-slate-500">
            {asr === "doubao" ? t("recorder.doubaoProcessing") : t("recorder.whisperProcessing")}
          </span>
        )}
        {recording && asr === "browser" && (
          <span className="text-xs text-slate-500">{t("recorder.browserHint")}</span>
        )}
        {recording && (asr === "whisper" || asr === "doubao") && (
          <span className="text-xs text-slate-500">{t("recorder.audioHint")}</span>
        )}
      </div>
      {interim && <div className="text-xs text-slate-500 italic">{t("recorder.recognizing", { text: interim })}</div>}
      {error && <div className="text-xs text-red-600">{error}</div>}
    </div>
  );
});

export default VoiceRecorder;

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function extractErrorMessage(value: Record<string, unknown>): string {
  return typeof value.error === "string" ? value.error : "";
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

function emptyLiveSnapshot(): LiveAsrSnapshot {
  return {
    status: "idle",
    text: "",
    finalText: "",
    interimText: "",
  };
}
