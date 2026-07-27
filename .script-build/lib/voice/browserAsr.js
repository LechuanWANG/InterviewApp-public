"use strict";
"use client";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isBrowserAsrSupported = isBrowserAsrSupported;
exports.createBrowserAsr = createBrowserAsr;
function isBrowserAsrSupported() {
    if (typeof window === "undefined")
        return false;
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}
function createBrowserAsr(lang = "zh-CN") {
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor)
        throw new Error("当前浏览器不支持 Web Speech API，请改用 Whisper 或换 Chrome");
    const r = new Ctor();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    return r;
}
