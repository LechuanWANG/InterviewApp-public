"use client";

import { useState } from "react";
import { useI18n } from "./LanguageProvider";
import LoadingIndicator from "./LoadingIndicator";

type ExperienceRatingProps = {
  kind: "interview" | "consult";
  targetId: string;
};

export default function ExperienceRating({ kind, targetId }: ExperienceRatingProps) {
  const { t } = useI18n();
  const [rating, setRating] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitRating(nextRating: number) {
    setRating(nextRating);
    setSaving(true);
    setSaved(false);
    setError(null);

    try {
      const endpoint = kind === "interview" ? "/api/feedback/interview" : "/api/feedback/consult";
      const body = kind === "interview"
        ? { sessionId: targetId, rating: nextRating }
        : { consultId: targetId, rating: nextRating };
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || t("feedback.error"));
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("feedback.error"));
    } finally {
      setSaving(false);
    }
  }

  const activeRating = hovered || rating;

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-medium text-slate-900">
            {kind === "interview" ? t("feedback.interviewTitle") : t("feedback.consultTitle")}
          </div>
          <div className="mt-1 text-xs text-slate-600">{t("feedback.description")}</div>
        </div>

        <div className="flex items-center gap-1">
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => submitRating(value)}
              onMouseEnter={() => setHovered(value)}
              onMouseLeave={() => setHovered(0)}
              disabled={saving}
              aria-label={t("feedback.starLabel", { count: value })}
              className={`text-2xl leading-none transition disabled:opacity-60 ${
                value <= activeRating ? "text-amber-500" : "text-slate-300"
              }`}
            >
              ★
            </button>
          ))}
        </div>
      </div>

      <div className="mt-2 min-h-5 text-xs">
        {saving && <LoadingIndicator variant="inline" label={t("feedback.saving")} className="text-xs" />}
        {!saving && saved && <span className="text-emerald-700">{t("feedback.saved")}</span>}
        {!saving && error && <span className="text-red-600">{error}</span>}
      </div>
    </div>
  );
}
