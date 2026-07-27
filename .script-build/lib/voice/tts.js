"use strict";
"use client";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AutoplayBlockedError = void 0;
exports.stopSpeaking = stopSpeaking;
exports.speak = speak;
let currentAudio = null;
class AutoplayBlockedError extends Error {
    constructor() {
        super("浏览器阻止自动播放，请点击页面任意位置后再试");
        this.name = "AutoplayBlockedError";
    }
}
exports.AutoplayBlockedError = AutoplayBlockedError;
function stopSpeaking() {
    if (typeof window !== "undefined")
        window.speechSynthesis?.cancel();
    if (currentAudio) {
        currentAudio.pause();
        currentAudio.src = "";
        currentAudio = null;
    }
}
async function speak(text, settings, language, options = {}) {
    stopSpeaking();
    if (settings.tts === "off" || !text.trim())
        return;
    if (settings.tts === "browser") {
        if (typeof window === "undefined" || !window.speechSynthesis) {
            throw new Error("当前浏览器不支持 speechSynthesis");
        }
        window.speechSynthesis.resume();
        return new Promise((resolve, reject) => {
            const u = new SpeechSynthesisUtterance(text);
            u.lang = language === "zh" ? "zh-CN" : "en-US";
            if (settings.voice) {
                const v = window.speechSynthesis
                    .getVoices()
                    .find((vv) => vv.voiceURI === settings.voice);
                if (v)
                    u.voice = v;
            }
            u.onstart = () => options.onPlaybackStart?.();
            u.onend = () => resolve();
            u.onerror = (e) => {
                const err = e.error || "unknown";
                if (err === "interrupted" || err === "canceled")
                    resolve();
                else
                    reject(new Error("浏览器朗读失败: " + err));
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
    return new Promise((resolve, reject) => {
        const audio = new Audio();
        currentAudio = audio;
        const cleanup = () => {
            URL.revokeObjectURL(url);
            if (currentAudio === audio)
                currentAudio = null;
        };
        audio.onended = () => { cleanup(); resolve(); };
        audio.onerror = () => { cleanup(); resolve(); };
        audio.onpause = () => {
            // stopSpeaking() 会触发 pause，此时也要 resolve 防止卡死
            if (audio.currentTime < audio.duration - 0.1) {
                cleanup();
                resolve();
            }
        };
        // 超时保护：如果 30 秒还没播完，强制 resolve
        const timeout = setTimeout(() => { cleanup(); resolve(); }, 30000);
        const origOnended = audio.onended;
        audio.onended = () => { clearTimeout(timeout); cleanup(); resolve(); };
        audio.src = url;
        audio.play().then(() => {
            options.onPlaybackStart?.();
        }).catch((e) => {
            clearTimeout(timeout);
            cleanup();
            if (e instanceof Error && e.name === "NotAllowedError") {
                reject(new AutoplayBlockedError());
            }
            else {
                reject(e instanceof Error ? e : new Error(String(e)));
            }
        });
    });
}
