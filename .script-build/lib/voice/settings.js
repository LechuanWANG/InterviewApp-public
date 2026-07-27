"use strict";
"use client";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadVoiceSettings = loadVoiceSettings;
exports.saveVoiceSettings = saveVoiceSettings;
const types_1 = require("./types");
const KEY = "interview-voice-settings";
function loadVoiceSettings() {
    if (typeof window === "undefined")
        return types_1.DEFAULT_VOICE_SETTINGS;
    try {
        const raw = localStorage.getItem(KEY);
        if (!raw)
            return types_1.DEFAULT_VOICE_SETTINGS;
        return normalizeVoiceSettings({ ...types_1.DEFAULT_VOICE_SETTINGS, ...JSON.parse(raw) });
    }
    catch {
        return types_1.DEFAULT_VOICE_SETTINGS;
    }
}
function saveVoiceSettings(s) {
    if (typeof window === "undefined")
        return;
    localStorage.setItem(KEY, JSON.stringify(normalizeVoiceSettings(s)));
}
function normalizeVoiceSettings(settings) {
    return {
        ...settings,
        asr: "doubao",
        tts: "doubao",
        voice: settings.voice || types_1.DEFAULT_VOICE_SETTINGS.voice,
    };
}
