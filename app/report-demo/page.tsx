"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ReportView from "@/components/ReportView";
import BackButton from "@/components/BackButton";
import LoadingIndicator, { LoadingDots } from "@/components/LoadingIndicator";
import type { Report, Round } from "@/lib/types";
import { useI18n } from "@/components/LanguageProvider";

type DemoPayload = {
  variant: DemoVariant;
  report: Report;
  rounds: Round[];
  company: string;
  jobTitle: string;
};

type DemoVariant = "good" | "bad" | "council-file";

export default function ReportDemoPage() {
  const { t } = useI18n();
  const [variant, setVariant] = useState<DemoVariant>("bad");
  const [data, setData] = useState<DemoPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(nextVariant = variant) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/report-demo?variant=${nextVariant}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "生成 Demo 报告失败");
      setData(json as DemoPayload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成 Demo 报告失败");
    } finally {
      setLoading(false);
    }
  }

  function selectVariant(nextVariant: DemoVariant) {
    setVariant(nextVariant);
    const nextUrl =
      nextVariant === "bad" ? "/report-demo" : `/report-demo?variant=${encodeURIComponent(nextVariant)}`;
    window.history.replaceState(null, "", nextUrl);
    load(nextVariant);
  }

  useEffect(() => {
    const nextVariant = new URLSearchParams(window.location.search).get("variant");
    if (nextVariant === "good" || nextVariant === "bad" || nextVariant === "council-file") {
      setVariant(nextVariant);
      load(nextVariant);
      return;
    }
    load("bad");
  }, []);

  return (
    <main className="max-w-3xl mx-auto px-6 py-10">
      <div className="mb-4 flex items-center justify-between gap-3">
        <BackButton />
        <Link href="/?expanded=1" className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white">
          {t("common.confirm")}
        </Link>
      </div>

      <div className="mb-6 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 space-y-2">
        <div>{t("demo.notice1")}</div>
        <div>{t("demo.notice2")}</div>
      </div>

      <div className="mb-6 flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={() => selectVariant("bad")}
          disabled={loading && variant === "bad"}
          className={`rounded-md px-4 py-2 text-sm ${variant === "bad" ? "bg-rose-600 text-white" : "border border-slate-300 bg-white text-slate-700"}`}
        >
          {t("demo.bad")}
        </button>
        <button
          type="button"
          onClick={() => selectVariant("good")}
          disabled={loading && variant === "good"}
          className={`rounded-md px-4 py-2 text-sm ${variant === "good" ? "bg-emerald-600 text-white" : "border border-slate-300 bg-white text-slate-700"}`}
        >
          {t("demo.good")}
        </button>
        <button
          type="button"
          onClick={() => selectVariant("council-file")}
          disabled={loading && variant === "council-file"}
          className={`rounded-md px-4 py-2 text-sm ${variant === "council-file" ? "bg-indigo-600 text-white" : "border border-slate-300 bg-white text-slate-700"}`}
        >
          智囊团报告
        </button>
        <button
          type="button"
          onClick={() => load(variant)}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {loading ? (
            <>
              <LoadingDots />
              {t("demo.regenerating")}
            </>
          ) : (
            t("demo.regenerate")
          )}
        </button>
        <span className="text-sm text-slate-500">
          {t("demo.current", {
            variant:
              variant === "bad"
                ? t("demo.badLabel")
                : variant === "good"
                  ? t("demo.goodLabel")
                  : "智囊团报告",
          })}
        </span>
        {loading && <LoadingIndicator variant="inline" label={t("demo.loading")} />}
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {!loading && data && (
        <ReportView
          report={data.report}
          rounds={data.rounds}
          company={data.company}
          jobTitle={data.jobTitle}
        />
      )}
    </main>
  );
}
