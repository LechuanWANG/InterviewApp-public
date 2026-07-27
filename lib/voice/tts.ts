"use client";

import type { VoiceSettings } from "./types";

let currentAudio: HTMLAudioElement | null = null;
const stoppedAudios = new WeakSet<HTMLAudioElement>();

type SpeakOptions = {
  onPlaybackStart?: () => void;
};

export class AutoplayBlockedError extends Error {
  constructor() {
    super("浏览器阻止自动播放，请点击页面任意位置后再试");
    this.name = "AutoplayBlockedError";
  }
}

export function stopSpeaking() {
  if (typeof window !== "undefined") window.speechSynthesis?.cancel();
  if (currentAudio) {
    stoppedAudios.add(currentAudio);
    currentAudio.pause();
    currentAudio.src = "";
    currentAudio = null;
  }
}

export async function speak(
  text: string,
  settings: VoiceSettings,
  language: "zh" | "en",
  options: SpeakOptions = {}
): Promise<void> {
  stopSpeaking();
  if (settings.tts === "off" || !text.trim()) return;

  if (settings.tts === "browser") {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      throw new Error("当前浏览器不支持 speechSynthesis");
    }
    window.speechSynthesis.resume();
    return new Promise<void>((resolve, reject) => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = language === "zh" ? "zh-CN" : "en-US";
      if (settings.voice) {
        const v = window.speechSynthesis
          .getVoices()
          .find((vv) => vv.voiceURI === settings.voice);
        if (v) u.voice = v;
      }
      u.onstart = () => options.onPlaybackStart?.();
      u.onend = () => resolve();
      u.onerror = (e) => {
        const err = (e as SpeechSynthesisErrorEvent).error || "unknown";
        if (err === "interrupted" || err === "canceled") resolve();
        else reject(new Error("浏览器朗读失败: " + err));
      };
      window.speechSynthesis.speak(u);
    });
  }

  const provider = settings.tts === "doubao" ? "doubao" : "openai";
  const defaultVoice = provider === "doubao" ? "" : "alloy";
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      provider,
      voice: settings.voice || defaultVoice,
      language,
      speedRatio: settings.speedRatio,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "TTS 请求失败");
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);

  return new Promise<void>((resolve, reject) => {
    const audio = new Audio();
    currentAudio = audio;

    const cleanup = () => {
      URL.revokeObjectURL(url);
      if (currentAudio === audio) currentAudio = null;
    };

    audio.onended = () => { cleanup(); resolve(); };
    audio.onerror = () => { cleanup(); resolve(); };
    audio.onpause = () => {
      // Only an explicit stopSpeaking() should resolve an unfinished playback.
      if (stoppedAudios.has(audio)) {
        clearTimeout(timeout);
        cleanup();
        resolve();
      }
    };

    // Long group-interview turns can exceed 30s; keep a generous guard only for truly stuck media.
    const timeoutMs = Math.min(120000, Math.max(30000, 8000 + text.trim().length * 450));
    const timeout = setTimeout(() => { cleanup(); resolve(); }, timeoutMs);
    audio.onended = () => { clearTimeout(timeout); cleanup(); resolve(); };

    audio.src = url;
    audio.play().then(() => {
      options.onPlaybackStart?.();
    }).catch((e) => {
      clearTimeout(timeout);
      cleanup();
      if (e instanceof Error && e.name === "NotAllowedError") {
        reject(new AutoplayBlockedError());
      } else {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  });
}
