"use client";

import { DEFAULT_VOICE_SETTINGS, type VoiceSettings } from "./types";

const KEY = "interview-voice-settings";

export function loadVoiceSettings(): VoiceSettings {
  if (typeof window === "undefined") return DEFAULT_VOICE_SETTINGS;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_VOICE_SETTINGS;
    return normalizeVoiceSettings({ ...DEFAULT_VOICE_SETTINGS, ...JSON.parse(raw) });
  } catch {
    return DEFAULT_VOICE_SETTINGS;
  }
}

export function saveVoiceSettings(s: VoiceSettings) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(normalizeVoiceSettings(s)));
}

function normalizeVoiceSettings(settings: VoiceSettings): VoiceSettings {
  return {
    ...settings,
    asr: "doubao",
    tts: "doubao",
    voice: settings.voice || DEFAULT_VOICE_SETTINGS.voice,
  };
}
