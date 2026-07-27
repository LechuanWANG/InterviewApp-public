"use client";

type SpeechRecognitionInstance = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { results: { 0: { transcript: string } }[] & { isFinal?: boolean }[] }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
  }
}

export function isBrowserAsrSupported(): boolean {
  if (typeof window === "undefined") return false;
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export function createBrowserAsr(lang: string = "zh-CN") {
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Ctor) throw new Error("当前浏览器不支持 Web Speech API，请改用 Whisper 或换 Chrome");
  const r = new Ctor();
  r.lang = lang;
  r.continuous = true;
  r.interimResults = true;
  return r;
}
