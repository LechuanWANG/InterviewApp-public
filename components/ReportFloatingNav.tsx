"use client";

import Link from "next/link";
import { useI18n } from "./LanguageProvider";

export default function ReportFloatingNav({
  consultHref,
  confirmHref,
  company,
  jobTitle,
  mbtiMode = false,
  showAnswers = true,
  titleKey,
  confirmLabelKey = "common.confirm",
}: {
  consultHref?: string;
  confirmHref: string;
  company: string;
  jobTitle: string;
  mbtiMode?: boolean;
  showAnswers?: boolean;
  titleKey?: string;
  confirmLabelKey?: string;
}) {
  const { t } = useI18n();

  function handleChapterClick(event: React.MouseEvent<HTMLAnchorElement>, href: string) {
    const target = document.getElementById(href.replace(/^#/, ""));
    if (!target) return; // 找不到目标时退回浏览器默认锚点跳转
    event.preventDefault();
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", href);
    }
  }

  const chapters = [
    { href: "#report-overview", label: mbtiMode ? t("report.nav.mbti") : t("report.nav.score") },
    { href: "#report-summary", label: t("report.nav.summary") },
    { href: "#report-records", label: t("report.nav.records") },
    ...(showAnswers ? [{ href: "#report-answers", label: t("report.nav.answers") }] : []),
  ];

  return (
    <div className="sticky top-3 z-40 mb-5 rounded-2xl border border-slate-200 bg-white/90 p-3 shadow-lg backdrop-blur-md">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center">
            <div className="min-w-0 shrink-0 lg:max-w-sm">
              <div className="truncate text-xs text-slate-500">
                {company} · {jobTitle}
              </div>
              <div className="text-base font-semibold text-slate-900">
                {titleKey ? t(titleKey) : mbtiMode ? t("report.mbtiTitle") : t("report.title")}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {chapters.map((chapter) => (
                <a
                  key={chapter.href}
                  href={chapter.href}
                  onClick={(event) => handleChapterClick(event, chapter.href)}
                  className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-200"
                >
                  {chapter.label}
                </a>
              ))}
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {consultHref && (
              <Link
                href={consultHref}
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-700"
              >
                {t("report.startConsult")}
              </Link>
            )}
            <Link
              href={confirmHref}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800"
            >
              {t(confirmLabelKey)}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
