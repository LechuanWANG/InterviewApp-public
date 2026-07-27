"use client";

import { useState } from "react";
import { type VoiceSettings } from "@/lib/voice/types";
import { useI18n } from "./LanguageProvider";

const SHUANGKUAI_SISI_VOICE = "zh_female_shuangkuaisisi_moon_bigtts";

export default function VoiceSettingsPanel({
  settings,
  onChange,
  language = "zh",
}: {
  settings: VoiceSettings;
  onChange: (s: VoiceSettings) => void;
  language?: "zh" | "en";
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  function update<K extends keyof VoiceSettings>(k: K, v: VoiceSettings[K]) {
    if (k === "tts") {
      const nextTts = v as VoiceSettings["tts"];
      const nextVoice = nextTts === "doubao" ? "zh_female_shuangkuaisisi_moon_bigtts" : "";
      onChange({ ...settings, tts: nextTts, voice: nextVoice });
      return;
    }
    onChange({ ...settings, [k]: v });
  }

  const ttsLabel = "Doubao";
  const asrLabel = "Doubao";
  const summary = t("voice.summary", { asr: asrLabel, tts: ttsLabel });
  const selectedDoubaoVoice =
    settings.voice === SHUANGKUAI_SISI_VOICE ? settings.voice : SHUANGKUAI_SISI_VOICE;

  return (
    <div className="bg-white border rounded-md text-sm">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-2 hover:bg-slate-50"
      >
        <span className="font-medium">{t("voice.title")}</span>
        <span className="text-xs text-slate-500">
          {summary} {open ? "▲" : "▼"}
        </span>
      </button>
      {open && (
        <div className="px-4 py-3 border-t space-y-3">
          <div>
            <label className="block text-xs text-slate-600 mb-1">{t("voice.asr")}</label>
            <select
              value={settings.asr}
              onChange={(e) => update("asr", e.target.value as VoiceSettings["asr"])}
              className="w-full border rounded p-1.5 text-sm"
            >
              <option value="doubao">{t("voice.doubaoAsr")}</option>
              <option value="browser" disabled>{t("voice.soon")}</option>
            </select>
          </div>

          <div>
            <label className="block text-xs text-slate-600 mb-1">{t("voice.tts")}</label>
            <select
              value={settings.tts}
              onChange={(e) => update("tts", e.target.value as VoiceSettings["tts"])}
              className="w-full border rounded p-1.5 text-sm"
            >
              <option value="doubao">{t("voice.doubaoTts")}</option>
              <option value="browser" disabled>{t("voice.soon")}</option>
            </select>
          </div>

          {settings.tts === "doubao" && (
            <div>
              <label className="block text-xs text-slate-600 mb-1">{t("voice.doubaoVoice")}</label>
              <select
                value={selectedDoubaoVoice}
                onChange={(e) => update("voice", e.target.value)}
                className="w-full border rounded p-1.5 text-sm"
              >
                <option value={SHUANGKUAI_SISI_VOICE}>爽快思思</option>
                <option value="coming-soon" disabled>{t("voice.soon")}</option>
              </select>
              <p className="text-xs text-slate-500 mt-1">
                {t("voice.hint")}
              </p>
            </div>
          )}

          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={settings.autoPlay}
              onChange={(e) => update("autoPlay", e.target.checked)}
            />
            {t("voice.autoPlay")}
          </label>

          <div className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
            {language === "en"
              ? "Voice playback and microphone checks will run in the next required step."
              : "音色播放和麦克风检查会在下一步固定测试流程中完成。"}
          </div>
        </div>
      )}
    </div>
  );
}
