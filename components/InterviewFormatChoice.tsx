"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import BackButton from "./BackButton";
import { useI18n } from "./LanguageProvider";
import { INTERVIEW_FORMAT_KEY, type InterviewFormat } from "@/lib/interviewFormat";
import { LoadingDots } from "./LoadingIndicator";

type ChoiceConfig = {
  format: InterviewFormat;
  code: string;
  icon: ReactNode;
  titleKey: string;
  tagKey: string;
  descriptionKey: string;
  points: string[];
  panelClass: string;
  glowClass: string;
  iconClass: string;
  tagClass: string;
  bulletClass: string;
  ctaClass: string;
  railClass: string;
};

const oneOnOneIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
    <path d="M8 10h8M8 14h5" />
    <path d="M21 12a8 8 0 0 1-8 8H5.5a1.5 1.5 0 0 1-1.06-2.56A8 8 0 1 1 21 12Z" />
  </svg>
);

const groupIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
    <circle cx="9" cy="8" r="3" />
    <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
    <path d="M16 6.2a3 3 0 0 1 0 5.6" />
    <path d="M18 13.5a5.5 5.5 0 0 1 3.5 5.1" />
  </svg>
);

const choices: ChoiceConfig[] = [
  {
    format: "one_on_one",
    code: "1:1",
    icon: oneOnOneIcon,
    titleKey: "interviewChoice.oneOnOne",
    tagKey: "interviewChoice.oneOnOneTag",
    descriptionKey: "interviewChoice.oneOnOneDesc",
    points: ["interviewChoice.oneOnOnePoint1", "interviewChoice.oneOnOnePoint2"],
    panelClass: "border-sky-200/80 bg-gradient-to-br from-sky-50 to-white hover:border-sky-300",
    glowClass: "from-sky-200/60",
    iconClass: "border-sky-200 bg-sky-100 text-sky-700",
    tagClass: "bg-sky-100 text-sky-800",
    bulletClass: "bg-sky-500",
    ctaClass: "bg-sky-700 text-white group-hover:bg-sky-800",
    railClass: "bg-gradient-to-r from-sky-400 to-sky-600",
  },
  {
    format: "group",
    code: "GD",
    icon: groupIcon,
    titleKey: "interviewChoice.group",
    tagKey: "interviewChoice.groupTag",
    descriptionKey: "interviewChoice.groupDesc",
    points: ["interviewChoice.groupPoint1", "interviewChoice.groupPoint2"],
    panelClass: "border-emerald-200/80 bg-gradient-to-br from-emerald-50 to-white hover:border-emerald-300",
    glowClass: "from-emerald-200/60",
    iconClass: "border-emerald-200 bg-emerald-100 text-emerald-700",
    tagClass: "bg-amber-100 text-amber-800",
    bulletClass: "bg-emerald-500",
    ctaClass: "bg-emerald-700 text-white group-hover:bg-emerald-800",
    railClass: "bg-gradient-to-r from-emerald-400 to-amber-400",
  },
];

export default function InterviewFormatChoice() {
  const router = useRouter();
  const { t } = useI18n();
  const [selected, setSelected] = useState<InterviewFormat | null>(null);

  const choose = (format: InterviewFormat) => {
    setSelected(format);
    try {
      sessionStorage.setItem(INTERVIEW_FORMAT_KEY, format);
    } catch {
      // sessionStorage 不可用时，CreateForm 会按默认(一对一)路由处理。
    }
    window.setTimeout(() => router.push("/interview/new"), 320);
  };

  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div
          className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-gradient-to-br from-sky-200/50 to-emerald-200/40 blur-3xl"
          aria-hidden="true"
        />
        <div className="relative flex flex-col gap-6 p-7 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-medium text-white">
                {t("newInterview.kicker")}
              </span>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
                {t("interviewChoice.formatCount")}
              </span>
            </div>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
              {t("interviewChoice.title")}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
              {t("interviewChoice.subtitle")}
            </p>
          </div>
          <BackButton fallbackHref="/?expanded=1" labelId="report.backHome" alwaysFallback />
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        {choices.map((choice) => {
          const active = selected === choice.format;
          return (
            <button
              key={choice.format}
              type="button"
              onClick={() => choose(choice.format)}
              className={`group relative overflow-hidden rounded-2xl border p-0 text-left shadow-sm outline-none transition-all duration-200 hover:-translate-y-1 hover:shadow-xl focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-2 ${choice.panelClass}`}
            >
              <div
                className={`pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-gradient-to-br to-transparent opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-100 ${choice.glowClass}`}
                aria-hidden="true"
              />
              <div className={`h-1.5 w-full ${choice.railClass}`} aria-hidden="true" />
              <div className="relative flex min-h-[320px] flex-col p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex h-12 w-12 items-center justify-center rounded-xl border transition ${choice.iconClass}`}
                      aria-hidden="true"
                    >
                      {choice.icon}
                    </div>
                    <span
                      className="rounded-md border border-slate-200 bg-white/80 px-2 py-0.5 text-xs font-semibold tracking-wide text-slate-500 transition"
                      aria-hidden="true"
                    >
                      {choice.code}
                    </span>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-medium transition ${choice.tagClass}`}
                  >
                    {t(choice.tagKey)}
                  </span>
                </div>

                <div className="mt-6">
                  <h2 className="text-xl font-semibold text-slate-950">{t(choice.titleKey)}</h2>
                  <p className="mt-3 min-h-[72px] text-sm leading-6 text-slate-600">
                    {t(choice.descriptionKey)}
                  </p>
                </div>

                <div className="mt-5 grid gap-2">
                  {choice.points.map((pointKey) => (
                    <div
                      key={pointKey}
                      className="flex items-start gap-3 rounded-lg border border-white/60 bg-white/70 px-3 py-2 text-sm text-slate-700 shadow-sm backdrop-blur-sm"
                    >
                      <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${choice.bulletClass}`} />
                      <span>{t(pointKey)}</span>
                    </div>
                  ))}
                </div>

                <div className="mt-auto pt-6">
                  <div
                    className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium shadow-sm transition ${choice.ctaClass}`}
                  >
                    <span>{active ? t("interviewChoice.entering") : t("interviewChoice.choose")}</span>
                    {active ? (
                      <LoadingDots />
                    ) : (
                      <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">
                        &rarr;
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
