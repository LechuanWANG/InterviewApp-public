"use client";

import type { CSSProperties, KeyboardEvent, MutableRefObject, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import VoiceRecorder from "./VoiceRecorder";
import type { VoiceRecorderHandle } from "./VoiceRecorder";
import { speak, stopSpeaking } from "@/lib/voice/tts";
import { GROUP_INTERVIEW_HOST_VOICE, type VoiceSettings } from "@/lib/voice/types";
import { readConsultVoiceEnabled } from "@/lib/consultation/voicePreference";
import { useI18n } from "./LanguageProvider";
import ExperienceRating from "./ExperienceRating";
import BackButton from "./BackButton";
import LoadingIndicator, { LoadingDots } from "./LoadingIndicator";
import Markdown from "./Markdown";

type ConsultMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
};

type ConsultSummary = {
  currentJudgement: string;
  primaryTarget: string;
  notRecommended: string[];
  repeatedIssues: string[];
  nextPracticeFocus: string[];
  sevenDayPlan: string[];
};

type ConsultMemory = {
  pastSessionCount: number;
  compactProfile?: {
    compactSummary: string;
    currentTarget: string | null;
    avoidTargets: string[];
    stableStrengths: string[];
    recurringIssues: string[];
    resolvedIssues: string[];
    practiceFocus: string[];
    recentShift: string | null;
    evidenceRefs: string[];
    sourceSessionCount: number;
    updatedAt: number;
  } | null;
  graph?: {
    nodes: Array<{
      id: string;
      type:
        | "profile"
        | "target"
        | "avoid_target"
        | "strength"
        | "risk"
        | "resolved_issue"
        | "practice_focus"
        | "topic"
        | "evidence";
      label: string;
      summary: string;
      weight: number;
      status: "active" | "resolved" | "archived" | "superseded";
      sourceSessionIds: string[];
      evidenceRefs: string[];
      lastSeenAt: number;
    }>;
    edges: Array<{
      id: string;
      sourceNodeId: string;
      targetNodeId: string;
      relationType: string;
      weight: number;
    }>;
    sourceSessionCount: number;
    summary: string | null;
    updatedAt: number | null;
  } | null;
  sourceItems?: Array<{
    type: "user_profile" | "interview_evidence" | "consultation_memory" | "common_issues";
    content: string;
    sourceTitle: string | null;
    quoteOrSummary: string | null;
    confidence: number;
    tags: string[];
    lastSeenAt: number;
  }>;
  latestJudgement: string | null;
  latestPrimaryTarget: string | null;
  targetRoles: string[];
  avoidRoles: string[];
  repeatedIssues: string[];
  recentAdvice: string[];
  discussedTopics: Array<{
    topic: string;
    label: string;
    count: number;
  }>;
  recentQuestions: string[];
};

type ConsultPayload = {
  id: string;
  summaryMode: "single_session" | "multi_session";
  goal: string;
  memoryEnabled: boolean;
  status: "active" | "stopped" | "completed";
  summary: ConsultSummary | null;
  memory: ConsultMemory;
  messages: ConsultMessage[];
  selectedRecords: Array<{
    id: string;
    company: string;
    jobTitle: string;
    overallBand: number;
    reportedAt: number;
  }>;
};

type SummaryTab = "conclusion" | "profile";

const CONSULT_VOICE_SETTINGS: VoiceSettings = {
  asr: "doubao",
  tts: "doubao",
  voice: GROUP_INTERVIEW_HOST_VOICE, // 爽快思思（与面试官同款音色）
  // 暂时关闭战略咨询的语音播报（UI 不变）；canPlayConsultVoice 依赖 autoPlay，置 false 即全局静音。
  autoPlay: false,
};

export default function ConsultChat({ consultId }: { consultId: string }) {
  const router = useRouter();
  const { language, t } = useI18n();
  const [data, setData] = useState<ConsultPayload | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [hiddenAssistantMessageId, setHiddenAssistantMessageId] = useState<string | null>(null);
  const [summaryTab, setSummaryTab] = useState<SummaryTab>("conclusion");
  const [showCelebration, setShowCelebration] = useState(false);
  const pendingSpeechIdRef = useRef<string | null>(null);
  const syncInitialAssistantRef = useRef<boolean | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const summarySectionRef = useRef<HTMLDivElement | null>(null);
  const recorderRef = useRef<VoiceRecorderHandle | null>(null);
  const celebrationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const summaryScrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [consultRecording, setConsultRecording] = useState(false);

  useEffect(() => {
    if (!readConsultVoiceEnabled(consultId)) stopSpeaking();
    load();
    return () => stopSpeaking();
  }, [consultId]);

  useEffect(() => {
    return () => {
      if (celebrationTimeoutRef.current) clearTimeout(celebrationTimeoutRef.current);
      if (summaryScrollTimeoutRef.current) clearTimeout(summaryScrollTimeoutRef.current);
    };
  }, []);

  const selectedTitle = useMemo(() => {
    if (!data?.selectedRecords?.length) return "";
    if (data.selectedRecords.length === 1) {
      const record = data.selectedRecords[0];
      return `${record.jobTitle} · ${record.company}`;
    }
    return t("consult.selectedMulti", { count: data.selectedRecords.length });
  }, [data, t]);

  const visibleMessages = useMemo(
    () => data?.messages.filter((message) => message.id !== hiddenAssistantMessageId) ?? [],
    [data?.messages, hiddenAssistantMessageId]
  );

  const showTypingBubble = sending || stopping || Boolean(hiddenAssistantMessageId);

  useEffect(() => {
    const element = messageListRef.current;
    if (!element) return;
    element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
  }, [visibleMessages.length, showTypingBubble]);

  async function fetchConsultPayload() {
    const res = await fetch(`/api/consult/${consultId}`, { cache: "no-store" });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "加载战略咨询会话失败");
    return json as ConsultPayload;
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const json = await fetchConsultPayload();
      const lastMessage = json.messages[json.messages.length - 1];
      const isPendingSpeech = Boolean(lastMessage?.id && pendingSpeechIdRef.current === lastMessage.id);
      const shouldSyncInitialAssistant = isPendingSpeech || shouldSyncNewConsultOpening(consultId, syncInitialAssistantRef);
      const shouldSyncAssistant =
        canPlayConsultVoice() &&
        json.status !== "completed" &&
        lastMessage?.role === "assistant" &&
        !hasSpokenConsultMessage(lastMessage.id) &&
        shouldSyncInitialAssistant;

      if (shouldSyncAssistant) {
        setHiddenAssistantMessageId(lastMessage.id);
        setData(json);
        void playAssistantMessageWhenReady(lastMessage);
      } else {
        setHiddenAssistantMessageId(null);
        setData(json);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载战略咨询会话失败");
    } finally {
      setLoading(false);
    }
  }

  async function sendMessage(content: string) {
    const trimmed = content.trim();
    if (!trimmed || sending || !data || data.status === "completed") return;
    setSending(true);
    setError(null);
    setDraft("");

    const optimisticUser: ConsultMessage = {
      id: `temp-${Date.now()}`,
      role: "user",
      content: trimmed,
      createdAt: Date.now(),
    };
    setData({
      ...data,
      messages: [...data.messages, optimisticUser],
    });

    try {
      const res = await fetch(`/api/consult/${consultId}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: trimmed }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "发送失败");
      const latest = await fetchConsultPayload();
      const assistantMessage = findLatestAssistantMessage(latest.messages, json.message);
      const summaryReady = latest.status === "completed" && Boolean(latest.summary);
      if (summaryReady) {
        setSummaryTab("conclusion");
        scrollToSummarySection();
      }

      if (assistantMessage && canPlayConsultVoice()) {
        setHiddenAssistantMessageId(assistantMessage.id);
        setData(latest);
        void playAssistantMessageWhenReady(assistantMessage, {
          onReveal: () => setSending(false),
        });
        return;
      }

      setHiddenAssistantMessageId(null);
      setData(latest);
      setSending(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "发送失败");
      await load();
      setSending(false);
    }
  }

  function handleDraftKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void sendMessage(draft);
  }

  function toggleRecording() {
    if (sending || stopping || data?.status === "completed") return;
    if (consultRecording) {
      recorderRef.current?.stopRecording();
    } else {
      recorderRef.current?.startRecording();
    }
  }

  function triggerCompletionCelebration() {
    setShowCelebration(true);
    if (celebrationTimeoutRef.current) clearTimeout(celebrationTimeoutRef.current);
    celebrationTimeoutRef.current = setTimeout(() => {
      setShowCelebration(false);
      celebrationTimeoutRef.current = null;
    }, 3400);
  }

  function scrollToSummarySection() {
    if (summaryScrollTimeoutRef.current) clearTimeout(summaryScrollTimeoutRef.current);
    summaryScrollTimeoutRef.current = setTimeout(() => {
      summarySectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      summaryScrollTimeoutRef.current = null;
    }, 180);
  }

  async function stopAndSummarize() {
    if (stopping) return;
    setStopping(true);
    setError(null);
    try {
      const res = await fetch(`/api/consult/${consultId}/stop`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "生成战略咨询结论失败");
      const latest = await fetchConsultPayload();
      const assistantMessage = findLatestAssistantMessage(latest.messages, json.message);
      setSummaryTab("conclusion");
      scrollToSummarySection();

      if (assistantMessage && canPlayConsultVoice()) {
        setHiddenAssistantMessageId(assistantMessage.id);
        setData(latest);
        void playAssistantMessageWhenReady(assistantMessage, {
          onReveal: () => {
            setStopping(false);
            triggerCompletionCelebration();
          },
        });
        return;
      }

      setHiddenAssistantMessageId(null);
      setData(latest);
      setStopping(false);
      triggerCompletionCelebration();
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成战略咨询结论失败");
      setStopping(false);
    }
  }

  async function playAssistantMessageWhenReady(
    message: ConsultMessage,
    options: { onReveal?: () => void } = {}
  ) {
    setHiddenAssistantMessageId(message.id);

    if (pendingSpeechIdRef.current === message.id) return;

    let revealed = false;
    const reveal = () => {
      if (revealed) return;
      revealed = true;
      markConsultMessageSpoken(message.id);
      setHiddenAssistantMessageId((current) => current === message.id ? null : current);
      options.onReveal?.();
    };

    if (
      !canPlayConsultVoice() ||
      hasSpokenConsultMessage(message.id)
    ) {
      reveal();
      return;
    }

    pendingSpeechIdRef.current = message.id;
    try {
      await speak(toConsultSpeechText(message.content), CONSULT_VOICE_SETTINGS, "zh", {
        onPlaybackStart: reveal,
      });
      reveal();
    } catch {
      reveal();
    } finally {
      if (pendingSpeechIdRef.current === message.id) {
        pendingSpeechIdRef.current = null;
      }
    }
  }

  function canPlayConsultVoice() {
    return CONSULT_VOICE_SETTINGS.autoPlay && readConsultVoiceEnabled(consultId);
  }

  if (loading) {
    return <LoadingIndicator label={t("consult.loading")} />;
  }

  if (!data) {
    return (
      <div className="space-y-4">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error || t("consult.notFound")}
        </div>
        <button
          type="button"
          onClick={() => router.push("/summary")}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white"
        >
          {t("consult.backSelection")}
        </button>
      </div>
    );
  }

  return (
    <div className="relative space-y-6">
      {showCelebration && (
        <CompletionCelebrationOverlay memoryEnabled={data.memoryEnabled} onClose={() => setShowCelebration(false)} />
      )}
      <div className="space-y-4">
        <div className="min-w-0 space-y-4">
          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.16),_transparent_34%),linear-gradient(135deg,_#f8fafc,_#ffffff_58%,_#ecfdf5)] p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-medium uppercase tracking-[0.24em] text-emerald-700">{t("consult.kicker")}</div>
                <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{t("consult.title")}</h1>
                <div className="mt-2 text-sm text-slate-600">{selectedTitle}</div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <BackButton fallbackHref="/consult/history" />
                <button
                  type="button"
                  onClick={stopAndSummarize}
                  disabled={stopping || data.status === "completed"}
                  className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-slate-900/10 transition hover:-translate-y-0.5 hover:bg-slate-800 disabled:translate-y-0 disabled:opacity-50"
                >
                  {data.status === "completed" ? (
                    t("consult.completed")
                  ) : stopping ? (
                    <>
                      <LoadingDots />
                      {t("consult.generating")}
                    </>
                  ) : (
                    t("consult.finish")
                  )}
                </button>
              </div>
            </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="flex h-[min(72vh,720px)] min-h-[560px] flex-col bg-white">
            <div ref={messageListRef} className="flex-1 space-y-4 overflow-y-auto bg-[linear-gradient(180deg,_#f8fafc_0%,_#ffffff_42%)] px-3 py-5 md:px-6">
              {visibleMessages.map((message) => (
                <div
                  key={message.id}
                  className={`max-w-[82%] px-[18px] py-3 text-sm leading-7 ${
                    message.role === "assistant"
                      ? "rounded-[26px] bg-white text-slate-800 shadow-sm ring-1 ring-slate-100"
                      : "ml-auto whitespace-pre-wrap rounded-[26px] bg-slate-950 text-white shadow-sm shadow-slate-900/10"
                  }`}
                >
                  {message.role === "assistant" ? (
                    <Markdown content={message.content} className="space-y-2 text-sm leading-7 text-slate-800" />
                  ) : (
                    message.content
                  )}
                </div>
              ))}
              {showTypingBubble && <TypingBubble label={t("consult.typing")} />}
            </div>

            {data.status !== "completed" && (
              <div className="shrink-0 border-t border-slate-100 bg-white/95 p-2.5 backdrop-blur md:p-3">
              <div className="rounded-3xl border border-slate-200 bg-white p-2.5 shadow-sm">
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={handleDraftKeyDown}
                  rows={2}
                  placeholder={t("consult.placeholder")}
                  className="max-h-28 min-h-[4.25rem] w-full resize-none rounded-2xl border border-transparent bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-emerald-200 focus:bg-white focus:ring-4 focus:ring-emerald-100"
                />
                <div className="mt-2 flex items-center justify-between gap-2 px-1">
                  <div className="min-w-0 flex-1">
                    <VoiceRecorder
                      ref={recorderRef}
                      asr="doubao"
                      language="zh"
                      hideControls
                      onRecordingStart={() => setConsultRecording(true)}
                      onRecordingStop={() => setConsultRecording(false)}
                      onTranscript={(text) => {
                        void sendMessage(text);
                      }}
                    />
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={toggleRecording}
                      disabled={sending || stopping}
                      className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-medium transition disabled:opacity-50 ${
                        consultRecording
                          ? "border-red-200 bg-red-50 text-red-700"
                          : "border-slate-200 bg-white text-slate-700 hover:border-red-200 hover:text-red-600"
                      }`}
                    >
                      <span className={`h-2 w-2 rounded-full ${consultRecording ? "animate-pulse bg-red-600" : "bg-red-500"}`} />
                      <span>{consultRecording ? t("recorder.stop") : t("recorder.start")}</span>
                    </button>
                  <button
                    type="button"
                    onClick={() => sendMessage(draft)}
                    disabled={!draft.trim() || sending}
                    className="rounded-full bg-emerald-600 px-4 py-2 text-xs font-medium text-white shadow-lg shadow-emerald-600/15 transition hover:-translate-y-0.5 hover:bg-emerald-700 disabled:translate-y-0 disabled:opacity-50"
                  >
                    {sending ? t("consult.sending") : t("consult.send")}
                  </button>
                  </div>
                </div>
              </div>
              </div>
            )}

            {error && (
              <div className="mx-4 mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}
          </div>
        </div>

        </div>
      </div>

      {sidebarCollapsed ? (
        <button
          type="button"
          onClick={() => setSidebarCollapsed(false)}
          className="fixed right-5 top-28 z-40 flex h-12 w-12 items-center justify-center rounded-full border border-slate-200 bg-white/90 text-slate-800 shadow-xl shadow-slate-900/10 backdrop-blur transition hover:-translate-y-0.5 hover:border-emerald-200 hover:text-emerald-700"
          aria-label={t("consult.expandLabel")}
          title={t("consult.expandLabel")}
        >
          <span className="relative flex h-5 w-5 items-center justify-center">
            <span className="absolute h-full w-full rounded-full border border-current opacity-40" />
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
          </span>
        </button>
      ) : (
        <>
          <button
            type="button"
            aria-label={t("consult.closePanel")}
            className="fixed inset-0 z-40 cursor-default bg-slate-950/20 backdrop-blur-[1px]"
            onClick={() => setSidebarCollapsed(true)}
          />
          <aside className="fixed inset-y-5 right-5 z-50 w-[min(24rem,calc(100vw-2.5rem))] overflow-hidden rounded-3xl border border-slate-200 bg-white/95 shadow-2xl shadow-slate-900/20 backdrop-blur">
            <div className="flex items-center justify-between border-b border-slate-100 bg-slate-950 px-5 py-4 text-white">
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-emerald-200">{t("consult.kicker")}</div>
                <div className="mt-1 text-sm font-semibold">{t("consult.memory")}</div>
              </div>
              <button
                type="button"
                onClick={() => setSidebarCollapsed(true)}
                className="rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs text-white transition hover:bg-white/20"
              >
                {t("consult.collapse")}
              </button>
            </div>

            <div className="h-[calc(100%-4.5rem)] space-y-4 overflow-y-auto p-4">
              <SidebarCard title={t("consult.memory")}>
                <MemoryBrief memory={data.memory} memoryEnabled={data.memoryEnabled} />
              </SidebarCard>

              {data.selectedRecords.length > 0 && (
              <SidebarCard title={t("consult.selectedRecords")}>
                <div className="space-y-2">
                  {data.selectedRecords.slice(0, 3).map((record) => (
                    <div key={record.id} className="rounded-2xl bg-slate-50 p-3">
                      <div className="line-clamp-2 text-sm font-medium leading-5">
                        {record.jobTitle} · {record.company}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {new Date(record.reportedAt).toLocaleDateString(language === "en" ? "en-US" : "zh-CN")} · {record.overallBand.toFixed(1)} / 9.0
                      </div>
                    </div>
                  ))}
                  {data.selectedRecords.length > 3 && (
                    <div className="rounded-2xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
                      {t("consult.moreSelectedRecords", { count: data.selectedRecords.length - 3 })}
                    </div>
                  )}
                </div>
              </SidebarCard>
              )}

              <SidebarCard title={t("consult.currentStatus")}>
                <div className="text-sm leading-6 text-slate-600">
                  {data.status === "completed"
                    ? t("consult.status.completed")
                    : data.goal === "open_chat"
                      ? t("consult.status.open")
                      : data.summaryMode === "single_session"
                        ? t("consult.status.single")
                        : t("consult.status.multi")}
                </div>
              </SidebarCard>
            </div>
          </aside>
        </>
      )}

      {data.status === "completed" && data.summary && (
        <div ref={summarySectionRef} className="scroll-mt-6 space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-col gap-3 border-b border-slate-100 pb-3 md:flex-row md:items-end md:justify-between">
              <div>
                <div className="text-xs font-medium uppercase tracking-[0.18em] text-emerald-700">{t("consult.kicker")}</div>
                <div className="mt-1 text-base font-semibold text-slate-950">{t("consult.summaryTitle")}</div>
              </div>
              <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 p-1">
                <button
                  type="button"
                  onClick={() => setSummaryTab("conclusion")}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                    summaryTab === "conclusion"
                      ? "bg-slate-950 text-white shadow-sm"
                      : "text-slate-600 hover:bg-white hover:text-slate-950"
                  }`}
                >
                  {t("consult.summaryTabConclusion")}
                </button>
                <button
                  type="button"
                  onClick={() => setSummaryTab("profile")}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                    summaryTab === "profile"
                      ? "bg-slate-950 text-white shadow-sm"
                      : "text-slate-600 hover:bg-white hover:text-slate-950"
                  }`}
                >
                  {t("consult.summaryTabProfile")}
                </button>
              </div>
            </div>
            {summaryTab === "conclusion" ? (
              <ConsultConclusionPage summary={data.summary} />
            ) : (
              <UpdatedProfilePage memory={data.memory} memoryEnabled={data.memoryEnabled} />
            )}
          </div>
          <ExperienceRating kind="consult" targetId={consultId} />
        </div>
      )}
    </div>
  );
}

function ConsultConclusionPage({ summary }: { summary: ConsultSummary }) {
  const { t } = useI18n();
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <SummarySection title={t("consult.currentJudgement")} items={[summary.currentJudgement]} tone="emerald" />
      <SummarySection title={t("consult.primaryTarget")} items={[summary.primaryTarget]} tone="blue" />
      <SummarySection title={t("consult.notRecommended")} items={summary.notRecommended} tone="rose" />
      <SummarySection title={t("consult.repeatedIssues")} items={summary.repeatedIssues} tone="amber" />
      <SummarySection title={t("consult.nextPractice")} items={summary.nextPracticeFocus} tone="sky" />
      <SummarySection title={t("consult.sevenDayPlan")} items={summary.sevenDayPlan} tone="slate" />
    </div>
  );
}

function UpdatedProfilePage({
  memory,
  memoryEnabled,
}: {
  memory: ConsultMemory;
  memoryEnabled: boolean;
}) {
  const { t } = useI18n();
  const compact = memory.compactProfile;
  const focusItems = getMemoryFocusItems(memory, t);
  const resolvedIssues = compact?.resolvedIssues?.slice(0, 6) || [];
  const graphNodes = memory.graph?.nodes || [];

  if (!memoryEnabled) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm leading-6 text-slate-600">
        {t("consult.updatedProfileDisabled")}
      </div>
    );
  }

  if (!memory.pastSessionCount) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm leading-6 text-slate-600">
        {t("consult.updatedProfileEmpty")}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-emerald-100 bg-emerald-50/40 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-sm font-semibold text-emerald-900">{t("consult.updatedProfileTitle")}</div>
            <div className="mt-1 text-sm leading-6 text-slate-700">
              {compact?.compactSummary || t("consult.updatedProfileDescription")}
            </div>
          </div>
          <div className="shrink-0 rounded-full bg-white px-3 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-100">
            {t("consult.memoryCountShort", { count: compact?.sourceSessionCount || memory.pastSessionCount })}
          </div>
        </div>
      </div>

      {focusItems.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {focusItems.map((item) => (
            <div key={`${item.label}-${item.value}`} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{item.label}</div>
              <div className="mt-2 text-sm leading-6 text-slate-800">{item.value}</div>
            </div>
          ))}
        </div>
      )}

      {resolvedIssues.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            {t("consult.memoryResolvedIssues")}
          </div>
          <div className="flex flex-wrap gap-2">
            {resolvedIssues.map((issue) => (
              <span key={issue} className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs text-emerald-700 ring-1 ring-emerald-100">
                {truncateText(issue, 42)}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-950">{t("consult.memoryGraph")}</div>
            <div className="mt-1 text-xs text-slate-500">{t("consult.updatedProfileGraphHint")}</div>
          </div>
          {graphNodes.length > 0 && (
            <div className="text-xs text-slate-500">
              {t("consult.memoryGraphTotalCount", { total: countVisibleProfileGraphNodes(memory) })}
            </div>
          )}
        </div>
        <MemoryGraphView memory={memory} size="wide" />
      </div>
    </div>
  );
}

type CelebrationStyle = CSSProperties & {
  "--consult-confetti-drift": string;
  "--consult-confetti-rotation": string;
};

const CELEBRATION_CONFETTI_COLORS = ["#10b981", "#2563eb", "#f59e0b", "#f43f5e", "#0ea5e9", "#64748b"];

function CompletionCelebrationOverlay({
  memoryEnabled,
  onClose,
}: {
  memoryEnabled: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const confetti = Array.from({ length: 42 }, (_, index) => {
    const width = 6 + (index % 3) * 3;
    const height = 10 + (index % 4) * 4;
    const style: CelebrationStyle = {
      left: `${(index * 29) % 100}%`,
      width,
      height,
      backgroundColor: CELEBRATION_CONFETTI_COLORS[index % CELEBRATION_CONFETTI_COLORS.length],
      animationDelay: `${(index % 14) * 85}ms`,
      animationDuration: `${1500 + (index % 6) * 180}ms`,
      "--consult-confetti-drift": `${((index % 9) - 4) * 28}px`,
      "--consult-confetti-rotation": `${(index % 2 === 0 ? 1 : -1) * (220 + index * 19)}deg`,
    };
    return { id: index, style };
  });

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center overflow-hidden bg-slate-950/20 px-4 backdrop-blur-[2px]">
      {confetti.map((item) => (
        <span
          key={item.id}
          aria-hidden="true"
          className="absolute top-0 rounded-sm opacity-0 [animation:consult-confetti-fall_linear_forwards]"
          style={item.style}
        />
      ))}
      <div className="relative z-10 w-full max-w-md rounded-3xl border border-white/80 bg-white/95 p-6 text-center shadow-2xl shadow-slate-950/20 [animation:consult-celebration-pop_420ms_ease-out_forwards]">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 ring-1 ring-emerald-100">
          <span className="h-5 w-5 rounded-full bg-emerald-500 shadow-[0_0_0_6px_rgba(16,185,129,0.14)]" />
        </div>
        <div className="mt-4 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
          {t("consult.celebrationKicker")}
        </div>
        <div className="mt-2 text-xl font-semibold tracking-tight text-slate-950">
          {memoryEnabled ? t("consult.celebrationProfileTitle") : t("consult.celebrationCompleteTitle")}
        </div>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          {memoryEnabled ? t("consult.celebrationProfileDesc") : t("consult.celebrationCompleteDesc")}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="mt-5 rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
        >
          {t("consult.celebrationDismiss")}
        </button>
      </div>
      <style jsx>{`
        @keyframes consult-confetti-fall {
          0% {
            opacity: 0;
            transform: translate3d(0, -12vh, 0) rotate(0deg);
          }
          12% {
            opacity: 1;
          }
          100% {
            opacity: 0;
            transform: translate3d(var(--consult-confetti-drift), 106vh, 0) rotate(var(--consult-confetti-rotation));
          }
        }

        @keyframes consult-celebration-pop {
          0% {
            opacity: 0;
            transform: translateY(12px) scale(0.96);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
      `}</style>
    </div>
  );
}

function SidebarCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{title}</div>
      {children}
    </div>
  );
}

type SummaryTone = "emerald" | "blue" | "rose" | "amber" | "sky" | "slate";

const SUMMARY_TONE_CLASS: Record<SummaryTone, { card: string; label: string; dot: string }> = {
  emerald: {
    card: "border-emerald-100 bg-emerald-50/40",
    label: "bg-emerald-100 text-emerald-800",
    dot: "bg-emerald-500",
  },
  blue: {
    card: "border-blue-100 bg-blue-50/40",
    label: "bg-blue-100 text-blue-800",
    dot: "bg-blue-500",
  },
  rose: {
    card: "border-rose-100 bg-rose-50/35",
    label: "bg-rose-100 text-rose-800",
    dot: "bg-rose-500",
  },
  amber: {
    card: "border-amber-100 bg-amber-50/35",
    label: "bg-amber-100 text-amber-800",
    dot: "bg-amber-500",
  },
  sky: {
    card: "border-sky-100 bg-sky-50/40",
    label: "bg-sky-100 text-sky-800",
    dot: "bg-sky-500",
  },
  slate: {
    card: "border-slate-200 bg-slate-50/70",
    label: "bg-slate-200 text-slate-700",
    dot: "bg-slate-500",
  },
};

function SummarySection({ title, items, tone = "slate" }: { title: string; items: string[]; tone?: SummaryTone }) {
  const visibleItems = items.filter((item) => item?.trim());
  if (!visibleItems.length) return null;
  const toneClass = SUMMARY_TONE_CLASS[tone];
  return (
    <div className={`min-h-[9rem] rounded-2xl border p-4 shadow-sm ${toneClass.card}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className={`rounded-full px-2.5 py-1 text-xs font-semibold ${toneClass.label}`}>{title}</div>
      </div>
      <ul className="space-y-2">
        {visibleItems.map((item, index) => (
          <li key={index} className="flex gap-2 text-sm leading-6 text-slate-700">
            <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${toneClass.dot}`} />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MemoryBrief({
  memory,
  memoryEnabled,
}: {
  memory: ConsultMemory;
  memoryEnabled: boolean;
}) {
  const { t } = useI18n();
  if (!memoryEnabled) {
    return <div className="text-sm leading-6 text-slate-600">{t("consult.memoryDisabled")}</div>;
  }
  if (!memory.pastSessionCount) {
    return <div className="text-sm leading-6 text-slate-600">{t("consult.noMemory")}</div>;
  }

  const compact = memory.compactProfile;
  const focusItems = getMemoryFocusItems(memory, t);
  const resolvedIssues = compact?.resolvedIssues?.slice(0, 5) || [];
  const graphNodes = memory.graph?.nodes || [];

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-900">
        {t("consult.memoryCountShort", { count: memory.pastSessionCount })}
        <span className="text-emerald-700"> {t("consult.memoryPanelHint")}</span>
      </div>

      {compact?.compactSummary && (
        <div className="rounded-2xl border border-emerald-100 bg-white p-3">
          <div className="mb-1 text-xs font-semibold text-emerald-700">{t("consult.memoryCompact")}</div>
          <div className="text-sm leading-6 text-slate-700">{compact.compactSummary}</div>
        </div>
      )}

      {graphNodes.length > 1 && (
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            {t("consult.memoryGraph")}
          </div>
          <MemoryGraphView memory={memory} />
        </div>
      )}

      {focusItems.length > 0 && (
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            {t("consult.memoryFocus")}
          </div>
          <div className="space-y-2">
            {focusItems.map((item) => (
              <div key={`${item.label}-${item.value}`} className="rounded-2xl bg-slate-50 p-3">
                <div className="text-xs font-medium text-slate-500">{item.label}</div>
                <div className="mt-1 text-sm leading-6 text-slate-800">{truncateText(item.value, 88)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {resolvedIssues.length > 0 && (
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            {t("consult.memoryResolvedIssues")}
          </div>
          <div className="flex flex-wrap gap-2">
            {resolvedIssues.map((issue) => (
              <span key={issue} className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs text-emerald-700 ring-1 ring-emerald-100">
                {truncateText(issue, 34)}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MemoryGraphView({ memory, size = "compact" }: { memory: ConsultMemory; size?: "compact" | "wide" }) {
  const { t } = useI18n();
  const graph = memory.graph;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [simNodes, setSimNodes] = useState<ForceNode[]>([]);
  const simNodesRef = useRef<ForceNode[]>([]);
  const dragTargetRef = useRef<{ id: string; x: number; y: number } | null>(null);
  const layout = useMemo(() => buildMemoryGraphLayout(graph), [graph]);
  const nodes = simNodes.length ? simNodes : layout.nodes.map((node) => ({ ...node, vx: 0, vy: 0 }));
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const selected = nodes.find((node) => node.id === selectedId) ||
    nodes.find((node) => node.type !== "profile") ||
    nodes[0] ||
    null;
  const selectedLinks = selected
    ? layout.edges
        .filter((edge) => edge.sourceNodeId === selected.id || edge.targetNodeId === selected.id)
        .map((edge) => {
          const otherId = edge.sourceNodeId === selected.id ? edge.targetNodeId : edge.sourceNodeId;
          return { edge, other: nodeById.get(otherId) };
        })
        .filter((item): item is { edge: LayoutEdge; other: ForceNode } => Boolean(item.other))
        .slice(0, 3)
    : [];
  const connectedEdgeIds = useMemo(() => {
    if (!selected) return new Set<string>();
    const ids = new Set<string>();
    for (const edge of layout.edges) {
      if (edge.sourceNodeId === selected.id || edge.targetNodeId === selected.id) ids.add(edge.id);
    }
    return ids;
  }, [selected, layout.edges]);
  const connectedNodeIds = useMemo(() => {
    if (!selected) return new Set<string>();
    const ids = new Set<string>([selected.id]);
    for (const edge of layout.edges) {
      if (edge.sourceNodeId === selected.id) ids.add(edge.targetNodeId);
      if (edge.targetNodeId === selected.id) ids.add(edge.sourceNodeId);
    }
    return ids;
  }, [selected, layout.edges]);

  useEffect(() => {
    const previousById = new Map(simNodesRef.current.map((node) => [node.id, node]));
    const next = layout.nodes.map((node) => {
      const previous = previousById.get(node.id);
      return {
        ...node,
        x: previous?.x ?? node.x,
        y: previous?.y ?? node.y,
        vx: previous?.vx ?? 0,
        vy: previous?.vy ?? 0,
      };
    });
    simNodesRef.current = next;
    setSimNodes(next);
    dragTargetRef.current = null;
    setDraggingId(null);
  }, [layout.nodes]);

  useEffect(() => {
    if (!layout.nodes.length) return;
    let frame = 0;
    let stopped = false;
    const tick = () => {
      if (stopped) return;
      const next = runMemoryGraphForceStep(simNodesRef.current, layout.edges, dragTargetRef.current);
      simNodesRef.current = next;
      setSimNodes(next);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
    };
  }, [layout.nodes.length, layout.edges]);

  if (!graph?.nodes?.length || layout.nodes.length <= 1) {
    return <div className="text-sm leading-6 text-slate-600">{t("consult.memoryGraphEmpty")}</div>;
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-[radial-gradient(circle_at_50%_45%,_rgba(16,185,129,0.13),_transparent_38%),linear-gradient(135deg,_#f8fafc,_#ffffff)]">
      <div className="flex items-center justify-between px-3 pt-3 text-[10px] text-slate-500">
        <span>{t("consult.memoryGraphDragHint")}</span>
        <span>{t("consult.memoryGraphTotalCount", { total: layout.nodes.length })}</span>
      </div>
      <svg
        viewBox="0 0 360 360"
        className={`${size === "wide" ? "h-[26rem]" : "h-72"} w-full touch-none select-none`}
        onPointerMove={(event) => {
          if (!draggingId) return;
          const point = svgPointFromPointer(event);
          dragTargetRef.current = {
            id: draggingId,
            x: clamp(point.x, GRAPH_BOUNDS.minX, GRAPH_BOUNDS.maxX),
            y: clamp(point.y, GRAPH_BOUNDS.minY, GRAPH_BOUNDS.maxY),
          };
        }}
        onPointerUp={() => {
          dragTargetRef.current = null;
          setDraggingId(null);
        }}
        onPointerCancel={() => {
          dragTargetRef.current = null;
          setDraggingId(null);
        }}
      >
        <g className="pointer-events-none opacity-35">
          <circle cx="180" cy="180" r="58" fill="none" stroke="#cbd5e1" strokeDasharray="3 7" />
          <circle cx="180" cy="180" r="116" fill="none" stroke="#cbd5e1" strokeDasharray="3 9" />
          <circle cx="180" cy="180" r="154" fill="none" stroke="#e2e8f0" strokeDasharray="2 10" />
        </g>
        <defs>
          <linearGradient id="memoryGraphLine" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.52" />
            <stop offset="100%" stopColor="#64748b" stopOpacity="0.18" />
          </linearGradient>
          <filter id="memoryGraphGlow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {layout.edges.map((edge) => {
          const source = nodeById.get(edge.sourceNodeId);
          const target = nodeById.get(edge.targetNodeId);
          if (!source || !target) return null;
          const isConnected = connectedEdgeIds.has(edge.id);
          return (
            <line
              key={edge.id}
              x1={source.x}
              y1={source.y}
              x2={target.x}
              y2={target.y}
              stroke={isConnected ? "#10b981" : "url(#memoryGraphLine)"}
              strokeWidth={isConnected ? Math.max(1.1, Math.min(3, edge.weight + 0.5)) : Math.max(0.8, Math.min(2.4, edge.weight))}
              strokeLinecap="round"
              opacity={connectedEdgeIds.size && !isConnected ? 0.22 : 1}
            />
          );
        })}
        {nodes.map((node) => {
          const style = memoryGraphNodeStyle(node.type);
          const radius = node.type === "profile"
            ? 35
            : Math.max(18, Math.min(28, 17 + node.weight * 2.2));
          const selectedNode = selected?.id === node.id;
          return (
            <g
              key={node.id}
              role="button"
              tabIndex={0}
              onClick={() => setSelectedId(node.id)}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                const svg = event.currentTarget.ownerSVGElement;
                if (svg) {
                  const point = svgPointFromClient(event.clientX, event.clientY, svg);
                  dragTargetRef.current = {
                    id: node.id,
                    x: clamp(point.x, GRAPH_BOUNDS.minX, GRAPH_BOUNDS.maxX),
                    y: clamp(point.y, GRAPH_BOUNDS.minY, GRAPH_BOUNDS.maxY),
                  };
                }
                setSelectedId(node.id);
                setDraggingId(node.id);
              }}
              onPointerUp={(event) => {
                event.currentTarget.releasePointerCapture(event.pointerId);
                dragTargetRef.current = null;
                setDraggingId(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") setSelectedId(node.id);
              }}
              className={`outline-none ${draggingId === node.id ? "cursor-grabbing" : "cursor-grab"}`}
            >
              <circle
                cx={node.x}
                cy={node.y}
                r={radius}
                fill={style.fill}
                stroke={selectedNode ? style.stroke : connectedNodeIds.has(node.id) ? style.stroke : "rgba(255,255,255,0.55)"}
                strokeWidth={selectedNode ? 2.6 : connectedNodeIds.has(node.id) ? 2 : 1.2}
                filter={selectedNode ? "url(#memoryGraphGlow)" : undefined}
                opacity={connectedNodeIds.size && !connectedNodeIds.has(node.id) ? 0.45 : 1}
              />
              <text
                x={node.x}
                y={node.y - 2}
                textAnchor="middle"
                className="pointer-events-none select-none fill-slate-900 text-[10px] font-semibold"
              >
                {compactSvgText(node.label, node.type === "profile" ? 7 : 5)}
              </text>
              <text
                x={node.x}
                y={node.y + 11}
                textAnchor="middle"
                className="pointer-events-none select-none fill-slate-500 text-[8px]"
              >
                {memoryGraphTypeLabel(node.type, t)}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="border-t border-slate-200/70 bg-white/78 p-3 backdrop-blur">
        {selected ? (
          <div>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-900">{selected.label}</div>
                <div className="mt-0.5 text-xs text-slate-500">
                  {memoryGraphTypeLabel(selected.type, t)} · {t("consult.memoryGraphWeight", { weight: selected.weight.toFixed(1) })}
                </div>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-medium ${selected.status === "resolved" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                {selected.status === "resolved" ? t("consult.memoryGraphResolved") : t("consult.memoryGraphActive")}
              </span>
            </div>
            <div className="mt-2 text-xs leading-5 text-slate-600">{selected.summary || t("consult.memoryGraphNoSummary")}</div>
            {selectedLinks.length > 0 && (
              <div className="mt-3 rounded-xl bg-slate-50 p-2">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                  {t("consult.memoryGraphConnections")}
                </div>
                <div className="space-y-1.5">
                  {selectedLinks.map(({ edge, other }) => (
                    <div key={`${edge.id}-${other.id}`} className="flex items-center gap-2 text-[11px] leading-4 text-slate-600">
                      <span className="rounded-full bg-white px-2 py-0.5 font-medium text-slate-500 ring-1 ring-slate-200">
                        {memoryGraphRelationLabel(edge.relationType, t)}
                      </span>
                      <span className="min-w-0 truncate">{other.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {selected.evidenceRefs.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {selected.evidenceRefs.slice(0, 3).map((source) => (
                  <span key={source} className="rounded-full bg-slate-100 px-2 py-1 text-[10px] text-slate-500">
                    {truncateText(source, 24)}
                  </span>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="text-xs leading-5 text-slate-500">{t("consult.memoryGraphEmpty")}</div>
        )}
      </div>
    </div>
  );
}

const GRAPH_BOUNDS = {
  minX: 28,
  maxX: 332,
  minY: 38,
  maxY: 330,
  centerX: 180,
  centerY: 180,
};

type LayoutNode = NonNullable<ConsultMemory["graph"]>["nodes"][number] & {
  x: number;
  y: number;
  anchorX: number;
  anchorY: number;
};

type LayoutEdge = NonNullable<ConsultMemory["graph"]>["edges"][number];

type ForceNode = LayoutNode & {
  vx: number;
  vy: number;
};

function buildMemoryGraphLayout(graph: ConsultMemory["graph"]): {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  nodeById: Map<string, LayoutNode>;
} {
  if (!graph?.nodes?.length) {
    return { nodes: [], edges: [], nodeById: new Map() };
  }

  const profileNodes = graph.nodes.filter(isProfileGraphNode);
  const root = profileNodes.find((node) => node.type === "profile") || graph.nodes.find((node) => node.type === "profile") || profileNodes[0];
  if (!root) return { nodes: [], edges: [], nodeById: new Map() };
  const conceptNodes = profileNodes
    .filter((node) => node.id !== root.id)
    .sort((left, right) => priorityForGraphType(left.type) - priorityForGraphType(right.type) || right.weight - left.weight);
  const selectedNodes = [root, ...conceptNodes];
  const nodes: LayoutNode[] = selectedNodes.map((node, index) => {
    const anchor = graphAnchorForNode(node, index, selectedNodes.length);
    return {
      ...node,
      x: anchor.x,
      y: anchor.y,
      anchorX: anchor.x,
      anchorY: anchor.y,
    };
  });
  const nodeIds = new Set(nodes.map((node) => node.id));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const directEdges = graph.edges
    .filter((edge) => nodeIds.has(edge.sourceNodeId) && nodeIds.has(edge.targetNodeId));
  const edges = buildProfileDisplayEdges(nodes, directEdges, root.id);
  const connectedIds = new Set<string>();
  for (const edge of edges) {
    connectedIds.add(edge.sourceNodeId);
    connectedIds.add(edge.targetNodeId);
  }
  connectedIds.add(root.id);
  const filteredNodes = nodes.filter((node) => connectedIds.has(node.id));

  return { nodes: filteredNodes, edges, nodeById: new Map(filteredNodes.map((node) => [node.id, node])) };
}

function runMemoryGraphForceStep(
  nodes: ForceNode[],
  edges: LayoutEdge[],
  dragTarget: { id: string; x: number; y: number } | null
): ForceNode[] {
  if (!nodes.length) return nodes;

  const next = nodes.map((node) => ({ ...node }));
  const nodeById = new Map(next.map((node) => [node.id, node]));
  for (let leftIndex = 0; leftIndex < next.length; leftIndex += 1) {
    const left = next[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < next.length; rightIndex += 1) {
      const right = next[rightIndex];
      const dx = right.x - left.x;
      const dy = right.y - left.y;
      const distanceSq = Math.max(64, dx * dx + dy * dy);
      const distance = Math.sqrt(distanceSq);
      const force = Math.min(2.1, 320 / distanceSq);
      const fx = (dx / distance) * force;
      const fy = (dy / distance) * force;
      left.vx -= fx;
      left.vy -= fy;
      right.vx += fx;
      right.vy += fy;
    }
  }

  for (const edge of edges) {
    const source = nodeById.get(edge.sourceNodeId);
    const target = nodeById.get(edge.targetNodeId);
    if (!source || !target) continue;
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    const desired = desiredGraphEdgeLength(edge);
    const strength = 0.0022 * Math.max(0.7, Math.min(2.2, edge.weight));
    const force = (distance - desired) * strength;
    const fx = (dx / distance) * force;
    const fy = (dy / distance) * force;
    source.vx += fx;
    source.vy += fy;
    target.vx -= fx;
    target.vy -= fy;
  }

  for (const node of next) {
    const isRoot = node.type === "profile";
    const anchorPull = isRoot ? 0.022 : 0.003;
    node.vx += (node.anchorX - node.x) * anchorPull;
    node.vy += (node.anchorY - node.y) * anchorPull;
    if (!isRoot) {
      node.vx += (GRAPH_BOUNDS.centerX - node.x) * 0.0018;
      node.vy += (GRAPH_BOUNDS.centerY - node.y) * 0.0018;
    }
    if (dragTarget?.id === node.id) {
      node.vx += (dragTarget.x - node.x) * 0.28;
      node.vy += (dragTarget.y - node.y) * 0.28;
    }
    node.vx *= dragTarget?.id === node.id ? 0.64 : 0.88;
    node.vy *= dragTarget?.id === node.id ? 0.64 : 0.88;
    node.x = clamp(node.x + node.vx, GRAPH_BOUNDS.minX, GRAPH_BOUNDS.maxX);
    node.y = clamp(node.y + node.vy, GRAPH_BOUNDS.minY, GRAPH_BOUNDS.maxY);
    if (node.x === GRAPH_BOUNDS.minX || node.x === GRAPH_BOUNDS.maxX) node.vx *= -0.2;
    if (node.y === GRAPH_BOUNDS.minY || node.y === GRAPH_BOUNDS.maxY) node.vy *= -0.2;
  }

  return next;
}

function graphAnchorForNode(
  node: NonNullable<ConsultMemory["graph"]>["nodes"][number],
  index: number,
  count: number
): { x: number; y: number } {
  if (node.type === "profile") return { x: GRAPH_BOUNDS.centerX, y: GRAPH_BOUNDS.centerY };

  const angle = deterministicGraphAngle(`${node.type}:${node.label}:${index}`) + index * 0.38;
  const ring = graphRingRadius(node.type, index, count);
  return {
    x: clamp(GRAPH_BOUNDS.centerX + Math.cos(angle) * ring, GRAPH_BOUNDS.minX, GRAPH_BOUNDS.maxX),
    y: clamp(GRAPH_BOUNDS.centerY + Math.sin(angle) * ring, GRAPH_BOUNDS.minY, GRAPH_BOUNDS.maxY),
  };
}

function buildProfileDisplayEdges(nodes: LayoutNode[], directEdges: LayoutEdge[], rootId: string): LayoutEdge[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const byType = groupLayoutNodesByType(nodes);
  const edges: LayoutEdge[] = [];
  const add = (source: LayoutNode | undefined, target: LayoutNode | undefined, relationType: string, weight = 1) => {
    if (!source || !target || source.id === target.id) return;
    edges.push({
      id: `display-${source.id}-${target.id}-${relationType}`,
      sourceNodeId: source.id,
      targetNodeId: target.id,
      relationType,
      weight,
    });
  };

  for (const edge of directEdges) {
    const source = nodeById.get(edge.sourceNodeId);
    const target = nodeById.get(edge.targetNodeId);
    if (!source || !target) continue;
    if (edge.relationType === "next_step") continue;
    edges.push(edge);
  }

  const root = nodeById.get(rootId) || byType.profile?.[0];
  const strengths = byType.strength || [];
  const risks = byType.risk || [];
  const resolved = byType.resolved_issue || [];
  const topics = byType.topic || [];
  const evidence = byType.evidence || [];

  for (const node of [...strengths.slice(0, 8), ...risks.slice(0, 8), ...topics.slice(0, 4), ...resolved.slice(0, 4), ...evidence.slice(0, 6)]) {
    add(root, node, "contains", Math.min(1.5, node.weight));
  }
  for (const node of strengths.slice(0, 6)) {
    add(node, topics[0] || root, "supports", 0.9);
  }
  for (const node of risks.slice(0, 8)) {
    add(node, topics[0] || root, "causes", 0.95);
  }
  for (const node of resolved.slice(0, 4)) {
    add(node, findRelatedRisk(node, risks) || root, "improves", 0.8);
  }
  for (const concept of [...risks, ...strengths, ...resolved, ...topics].slice(0, 14)) {
    const evidenceNode = findEvidenceNodeFor(concept, evidence);
    if (evidenceNode) add(concept, evidenceNode, "evidenced_by", 0.7);
  }

  const deduped = dedupeLayoutEdges(edges);
  if (deduped.length) return deduped;
  return nodes
    .filter((node) => node.id !== rootId)
    .slice(0, 10)
    .map((node) => ({
      id: `fallback-${rootId}-${node.id}`,
      sourceNodeId: rootId,
      targetNodeId: node.id,
      relationType: "contains",
      weight: Math.min(1.6, node.weight),
    }));
}

function groupLayoutNodesByType(nodes: LayoutNode[]): Partial<Record<LayoutNode["type"], LayoutNode[]>> {
  return nodes.reduce<Partial<Record<LayoutNode["type"], LayoutNode[]>>>((groups, node) => {
    groups[node.type] = [...(groups[node.type] || []), node];
    return groups;
  }, {});
}

function countVisibleProfileGraphNodes(memory: ConsultMemory): number {
  return memory.graph?.nodes.filter(isProfileGraphNode).length || 0;
}

function isProfileGraphNode(node: NonNullable<ConsultMemory["graph"]>["nodes"][number]): boolean {
  return ["profile", "strength", "risk", "resolved_issue", "topic", "evidence"].includes(node.type);
}

function graphRingRadius(type: LayoutNode["type"], index: number, count: number): number {
  const densityOffset = Math.min(28, Math.max(0, count - 8) * 2.4);
  if (type === "evidence") return 132 + (index % 3) * 10 + densityOffset * 0.4;
  if (type === "topic") return 90 + (index % 2) * 16;
  if (type === "resolved_issue") return 104 + (index % 3) * 12;
  if (type === "strength") return 112 + (index % 4) * 9 + densityOffset * 0.25;
  if (type === "risk") return 118 + (index % 4) * 10 + densityOffset * 0.3;
  return 122 + (index % 4) * 8;
}

function deterministicGraphAngle(seed: string): number {
  return (stableHash(seed) % 6283) / 1000;
}

function stableHash(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

function findRelatedRisk(node: LayoutNode, risks: LayoutNode[]): LayoutNode | undefined {
  const normalizedNode = normalizeDisplayText(`${node.label} ${node.summary}`);
  return risks.find((risk) => {
    const normalizedRisk = normalizeDisplayText(`${risk.label} ${risk.summary}`);
    return normalizedRisk.includes(normalizedNode.slice(0, 8)) ||
      normalizedNode.includes(normalizedRisk.slice(0, 8)) ||
      sharedCharacterCount(normalizedNode, normalizedRisk) >= 6;
  });
}

function findEvidenceNodeFor(concept: LayoutNode, evidence: LayoutNode[]): LayoutNode | undefined {
  if (!evidence.length) return undefined;
  const refs = concept.evidenceRefs.map(normalizeDisplayText).filter(Boolean);
  const matched = evidence.find((node) => {
    const label = normalizeDisplayText(node.label);
    return refs.some((ref) => ref.includes(label) || label.includes(ref));
  });
  if (matched) return matched;
  return evidence[stableHash(`${concept.type}:${concept.label}`) % evidence.length];
}

function sharedCharacterCount(left: string, right: string): number {
  const rightSet = new Set(right.split(""));
  return Array.from(new Set(left.split(""))).filter((char) => rightSet.has(char)).length;
}

function dedupeLayoutEdges(edges: LayoutEdge[]): LayoutEdge[] {
  const seen = new Set<string>();
  const result: LayoutEdge[] = [];
  for (const edge of edges) {
    const key = `${edge.sourceNodeId}:${edge.targetNodeId}:${edge.relationType}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(edge);
  }
  return result.slice(0, 36);
}

function desiredGraphEdgeLength(edge: LayoutEdge): number {
  if (edge.relationType === "evidenced_by") return 154;
  if (edge.relationType === "contains") return 128;
  if (edge.relationType === "supports" || edge.relationType === "causes") return 138;
  if (edge.relationType === "improves") return 126;
  return 132;
}

function priorityForGraphType(type: LayoutNode["type"]): number {
  if (type === "profile") return 0;
  if (type === "risk") return 1;
  if (type === "strength") return 2;
  if (type === "topic") return 3;
  if (type === "resolved_issue") return 4;
  if (type === "evidence") return 8;
  return 9;
}

function memoryGraphNodeStyle(type: LayoutNode["type"]): { fill: string; stroke: string } {
  if (type === "profile") return { fill: "#ecfdf5", stroke: "#059669" };
  if (type === "target") return { fill: "#dbeafe", stroke: "#2563eb" };
  if (type === "risk") return { fill: "#ffedd5", stroke: "#ea580c" };
  if (type === "practice_focus") return { fill: "#dcfce7", stroke: "#16a34a" };
  if (type === "strength") return { fill: "#e0f2fe", stroke: "#0284c7" };
  if (type === "resolved_issue") return { fill: "#d1fae5", stroke: "#059669" };
  if (type === "avoid_target") return { fill: "#fee2e2", stroke: "#dc2626" };
  if (type === "topic") return { fill: "#fef3c7", stroke: "#d97706" };
  return { fill: "#f1f5f9", stroke: "#64748b" };
}

function memoryGraphTypeLabel(
  type: LayoutNode["type"],
  t: (key: string, values?: Record<string, string | number>) => string
): string {
  if (type === "profile") return t("consult.memoryGraphType.profile");
  if (type === "target") return t("consult.memoryGraphType.target");
  if (type === "avoid_target") return t("consult.memoryGraphType.avoidTarget");
  if (type === "strength") return t("consult.memoryGraphType.strength");
  if (type === "risk") return t("consult.memoryGraphType.risk");
  if (type === "resolved_issue") return t("consult.memoryGraphType.resolved");
  if (type === "practice_focus") return t("consult.memoryGraphType.practice");
  if (type === "topic") return t("consult.memoryGraphType.topic");
  return t("consult.memoryGraphType.evidence");
}

function memoryGraphRelationLabel(
  type: LayoutEdge["relationType"],
  t: (key: string, values?: Record<string, string | number>) => string
): string {
  if (type === "supports") return t("consult.memoryGraphRelation.supports");
  if (type === "causes") return t("consult.memoryGraphRelation.causes");
  if (type === "conflicts_with") return t("consult.memoryGraphRelation.conflicts");
  if (type === "improves") return t("consult.memoryGraphRelation.improves");
  if (type === "evidenced_by") return t("consult.memoryGraphRelation.evidence");
  if (type === "next_step") return t("consult.memoryGraphRelation.nextStep");
  return t("consult.memoryGraphRelation.contains");
}

function compactSvgText(text: string, limit: number): string {
  const cleaned = text.replace(/\s+/g, "").trim();
  if (cleaned.length <= limit) return cleaned;
  return `${cleaned.slice(0, limit)}…`;
}

function svgPointFromPointer(event: React.PointerEvent<SVGSVGElement>): { x: number; y: number } {
  return svgPointFromClient(event.clientX, event.clientY, event.currentTarget);
}

function svgPointFromClient(clientX: number, clientY: number, svg: SVGSVGElement): { x: number; y: number } {
  const rect = svg.getBoundingClientRect();
  const viewBox = svg.viewBox.baseVal;
  return {
    x: ((clientX - rect.left) / rect.width) * viewBox.width + viewBox.x,
    y: ((clientY - rect.top) / rect.height) * viewBox.height + viewBox.y,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getMemoryFocusItems(memory: ConsultMemory, t: (key: string, values?: Record<string, string | number>) => string) {
  const compact = memory.compactProfile;
  const items: Array<{ label: string; value: string }> = [];
  addFocusItem(items, t("consult.memoryTarget"), compact?.currentTarget || memory.latestPrimaryTarget);
  addFocusItem(items, t("consult.memoryRecurringIssue"), compact?.recurringIssues?.[0] || memory.repeatedIssues[0]);
  addFocusItem(items, t("consult.memoryPracticeFocus"), compact?.practiceFocus?.[0] || memory.recentAdvice[0]);
  addFocusItem(items, t("consult.memoryRecentShift"), compact?.recentShift || null);
  addFocusItem(items, t("consult.memoryJudgement"), !compact?.compactSummary ? memory.latestJudgement : null);
  return items.slice(0, 4);
}

function addFocusItem(items: Array<{ label: string; value: string }>, label: string, value?: string | null) {
  if (!value?.trim()) return;
  if (items.some((item) => normalizeDisplayText(item.value) === normalizeDisplayText(value))) return;
  items.push({ label, value });
}

function truncateText(text: string, limit: number): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= limit) return cleaned;
  return `${cleaned.slice(0, limit - 3)}...`;
}

function normalizeDisplayText(text: string): string {
  return text.replace(/[，。！？；、\s"'""''\-—_]/g, "").toLowerCase();
}

function TypingBubble({ label }: { label: string }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-[26px] bg-slate-100 px-[18px] py-3 text-sm text-slate-500">
      <span>{label}</span>
      <span className="flex items-center gap-1">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.2s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.1s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" />
      </span>
    </div>
  );
}

function findLatestAssistantMessage(messages: ConsultMessage[], content?: string): ConsultMessage | null {
  const assistantMessages = messages.filter((message) => message.role === "assistant");
  if (!assistantMessages.length) return null;
  const normalizedContent = content?.trim();
  if (!normalizedContent) return assistantMessages[assistantMessages.length - 1];
  return [...assistantMessages].reverse().find((message) => message.content.trim() === normalizedContent) ??
    assistantMessages[assistantMessages.length - 1];
}

function hasSpokenConsultMessage(messageId: string): boolean {
  if (typeof window === "undefined") return false;
  return sessionStorage.getItem(spokenConsultMessageKey(messageId)) === "1";
}

function shouldSyncNewConsultOpening(
  consultId: string,
  syncInitialAssistantRef: MutableRefObject<boolean | null>
): boolean {
  if (syncInitialAssistantRef.current !== null) return syncInitialAssistantRef.current;
  if (typeof window === "undefined") {
    syncInitialAssistantRef.current = false;
    return false;
  }
  syncInitialAssistantRef.current = sessionStorage.getItem(newConsultEntryKey(consultId)) === "1";
  return syncInitialAssistantRef.current;
}

function markConsultMessageSpoken(messageId: string) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(spokenConsultMessageKey(messageId), "1");
}

function spokenConsultMessageKey(messageId: string): string {
  return `consult-spoken-message:${messageId}`;
}

function newConsultEntryKey(consultId: string): string {
  return `consult-new-entry:${consultId}`;
}

function toConsultSpeechText(text: string): string {
  return text
    .replace(/^#+\s*/gm, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/\*\*/g, "")
    .trim();
}
