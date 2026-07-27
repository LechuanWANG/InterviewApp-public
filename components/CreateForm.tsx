"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "./LanguageProvider";
import { LoadingDots } from "./LoadingIndicator";
import { readInterviewFormat, type InterviewFormat } from "@/lib/interviewFormat";

const DRAFT_KEY = "interview-create-draft";

type CreateDraft = {
  resume: string;
  company: string;
  jobTitle: string;
  jd: string;
  interviewType: string;
  language: "zh" | "en";
  format?: InterviewFormat;
  participantNameplate?: string;
  participantName?: string;
  participantBackground?: string;
};

export default function CreateForm() {
  const router = useRouter();
  const { t } = useI18n();
  const [resume, setResume] = useState("");
  const [participantNameplate, setParticipantNameplate] = useState("");
  const [company, setCompany] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [jd, setJd] = useState("");
  const [interviewType, setInterviewType] = useState("mixed");
  const [language, setLanguage] = useState<"zh" | "en">("zh");
  const [loading, setLoading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [resumeFileName, setResumeFileName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [format, setFormat] = useState<InterviewFormat | null>(null);

  useEffect(() => {
    const currentFormat = readInterviewFormat();
    setFormat(currentFormat);
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (!raw) return;

      const draft = JSON.parse(raw) as Partial<CreateDraft>;
      const savedResume = typeof draft.resume === "string" ? draft.resume : "";
      const savedNameplate =
        typeof draft.participantNameplate === "string" ? draft.participantNameplate : "";
      const savedName = typeof draft.participantName === "string" ? draft.participantName : "";
      const savedBackground =
        typeof draft.participantBackground === "string" ? draft.participantBackground : "";

      setResume(savedResume || (currentFormat === "group" || draft.format === "group" ? savedBackground : ""));
      setParticipantNameplate(savedNameplate || savedName);
      setCompany(typeof draft.company === "string" ? draft.company : "");
      setJobTitle(typeof draft.jobTitle === "string" ? draft.jobTitle : "");
      setJd(typeof draft.jd === "string" ? draft.jd : "");
      setInterviewType(typeof draft.interviewType === "string" ? draft.interviewType : "mixed");
      setLanguage(draft.language === "en" ? "en" : "zh");
    } catch {
      try {
        sessionStorage.removeItem(DRAFT_KEY);
      } catch {
        // Ignore storage cleanup failures; the form can still be filled manually.
      }
    } finally {
      setDraftLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!draftLoaded) return;
    if (!format) return;

    const hasUserContent = [
      resume,
      participantNameplate,
      company,
      jobTitle,
      jd,
    ].some((value) => value.trim().length > 0);
    try {
      if (!hasUserContent) {
        sessionStorage.removeItem(DRAFT_KEY);
        return;
      }

      sessionStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({
          resume,
          company,
          jobTitle,
          jd,
          interviewType,
          language,
          format,
          participantNameplate,
          participantName: participantNameplate,
        })
      );
    } catch {
      // Submit still reports storage failures; autosave should not interrupt typing.
    }
  }, [
    company,
    draftLoaded,
    format,
    interviewType,
    jd,
    jobTitle,
    language,
    participantNameplate,
    resume,
  ]);

  async function handlePdfUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setResumeFileName(file.name);
    setParsing(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/resume/parse", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "PDF 解析失败");
      setResume(data.text);
    } catch (err) {
      setError(err instanceof Error ? err.message : "PDF 解析失败");
      setResumeFileName("");
    } finally {
      setParsing(false);
      e.target.value = "";
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!format) return;
    setLoading(true);
    setError(null);
    try {
      sessionStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({
          resume,
          company,
          jobTitle,
          jd,
          interviewType,
          language,
          format,
          participantNameplate,
          participantName: participantNameplate,
        })
      );
      router.push(format === "group" ? "/setup/group" : "/setup");
    } catch (err) {
      setError(err instanceof Error ? err.message : "进入配置页失败");
      setLoading(false);
    }
  }

  return (
    !format ? (
      <div className="rounded-md border border-slate-200 bg-white p-6 text-sm text-slate-500">
        {t("create.loading")}
      </div>
    ) : (
    <form onSubmit={handleSubmit} className="space-y-5">
      {format === "group" ? (
        <div className="rounded-md border border-slate-200 bg-white p-5 space-y-5">
          <div className="space-y-1">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
              {t("create.groupProfileTitle")}
            </div>
            <p className="text-sm text-slate-600">{t("create.groupIntro")}</p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">{t("create.groupNameplate")}</label>
            <input
              value={participantNameplate}
              onChange={(e) => setParticipantNameplate(e.target.value)}
              required
              maxLength={40}
              className="w-full border rounded-md p-2 text-sm"
              placeholder={t("create.groupNameplatePlaceholder")}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">{t("create.groupResume")}</label>
            <div className="flex items-center gap-3 mb-2">
              <label className={`inline-flex cursor-pointer rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 ${parsing ? "pointer-events-none opacity-60" : ""}`}>
                {t("create.uploadResume")}
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={handlePdfUpload}
                  disabled={parsing}
                  className="sr-only"
                />
              </label>
              <span className="min-w-0 truncate text-sm text-slate-500">
                {resumeFileName || t("create.noFileSelected")}
              </span>
              {parsing && <span className="text-sm text-slate-500">{t("create.parsing")}</span>}
            </div>
            <textarea
              value={resume}
              onChange={(e) => setResume(e.target.value)}
              required
              rows={9}
              placeholder={t("create.groupResumePlaceholder")}
              className="w-full border rounded-md p-3 text-sm"
            />
          </div>
        </div>
      ) : (
        <div>
          <label className="block text-sm font-medium mb-1">{t("create.resume")}</label>
          <div className="flex items-center gap-3 mb-2">
            <label className={`inline-flex cursor-pointer rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 ${parsing ? "pointer-events-none opacity-60" : ""}`}>
              {t("create.uploadResume")}
              <input
                type="file"
                accept="application/pdf"
                onChange={handlePdfUpload}
                disabled={parsing}
                className="sr-only"
              />
            </label>
            <span className="min-w-0 truncate text-sm text-slate-500">
              {resumeFileName || t("create.noFileSelected")}
            </span>
            {parsing && <span className="text-sm text-slate-500">{t("create.parsing")}</span>}
          </div>
          <textarea
            value={resume}
            onChange={(e) => setResume(e.target.value)}
            required
            rows={10}
            placeholder={t("create.resumePlaceholder")}
            className="w-full border rounded-md p-3 text-sm"
          />
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">{t("create.company")}</label>
          <input
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            required
            className="w-full border rounded-md p-2 text-sm"
            placeholder={t("create.companyPlaceholder")}
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">{t("create.jobTitle")}</label>
          <input
            value={jobTitle}
            onChange={(e) => setJobTitle(e.target.value)}
            required
            className="w-full border rounded-md p-2 text-sm"
            placeholder={t("create.jobTitlePlaceholder")}
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">{t("create.jd")}</label>
        <textarea
          value={jd}
          onChange={(e) => setJd(e.target.value)}
          required
          rows={6}
          placeholder={t("create.jdPlaceholder")}
          className="w-full border rounded-md p-3 text-sm"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        {format !== "group" && (
          <div>
            <label className="block text-sm font-medium mb-1">{t("create.interviewType")}</label>
            <select
              value={interviewType}
              onChange={(e) => setInterviewType(e.target.value)}
              className="w-full border rounded-md p-2 text-sm"
            >
              <option value="mixed">{t("type.mixed")}</option>
              <option value="hr">{t("type.hr")}</option>
              <option value="technical">{t("type.technical")}</option>
              <option value="behavioral">{t("type.behavioral")}</option>
            </select>
          </div>
        )}
        <div>
          <label className="block text-sm font-medium mb-1">{t("create.language")}</label>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value === "en" ? "en" : "zh")}
            className="w-full border rounded-md p-2 text-sm"
          >
            <option value="zh">{t("app.chinese")}</option>
            <option value="en">English</option>
          </select>
        </div>
      </div>

      {error && <div className="text-red-600 text-sm">{error}</div>}

      <button
        type="submit"
        disabled={loading}
        className="inline-flex w-full items-center justify-center gap-2 bg-slate-900 text-white rounded-md py-3 text-sm font-medium disabled:opacity-50"
      >
        {loading ? (
          <>
            <LoadingDots />
            {t("create.entering")}
          </>
        ) : (
          t("create.next")
        )}
      </button>
    </form>
    )
  );
}
