"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "./LanguageProvider";
import type { InterviewPlanCouncil } from "@/lib/types";
import { CouncilDesignBrief } from "./council/CouncilDesignBrief";
import { CouncilStyles } from "./council/CouncilStyles";
import { CouncilTranscriptPanel } from "./council/CouncilTranscriptPanel";
import { RoundTable } from "./council/RoundTable";
import type {
  CouncilPageDraft,
  CouncilTurn,
  CouncilVariant,
  MeetingNote,
  RoleThinkingStatus,
  SpeakerState,
  StreamEvent,
  TranscriptItem,
} from "./council/types";
import {
  applyResolutionLog,
  buildResolutionLog,
  compactResult,
  defaultSpeakers,
  markSpeaker,
  phaseForEvent,
  transcriptKey,
} from "./council/utils";

const TRANSCRIPT_VISIBLE_TURNS = 4;
const TEMPORARY_NOTE_LIFETIME_MS = 14000;
const THINKING_STATUS_MIN_DISPLAY_MS = 4000;
const TRANSCRIPT_EXIT_MS = 560;
const INTERVIEW_OPENING_AVATAR_SRCS = [
  "/avatars/one-on-one-interviewer/1/opening.jpg",
  "/avatars/one-on-one-interviewer/2/opening.jpg",
  "/avatars/one-on-one-interviewer/3/opening.jpg",
  "/avatars/one-on-one-interviewer/4/opening.jpg",
];

/** 默认配置 = 一对一面试，保证既有行为零变化。 */
const ONE_ON_ONE_VARIANT: CouncilVariant = {
  draftKey: "interview-council-draft",
  streamEndpoint: "/api/session/council-stream",
  sessionRoutePrefix: "/interview/",
  fastEndpoint: "/api/session",
  buildFastBody: (draft) => ({ ...draft, useCouncil: false }),
  transitionKey: "interview-council-enter-transition",
  preloadAssets: INTERVIEW_OPENING_AVATAR_SRCS,
};

type QueuedThinkingStatus = {
  role?: string;
  status: RoleThinkingStatus;
};

export default function InterviewCouncilPage({ variant }: { variant?: CouncilVariant } = {}) {
  const cfg = variant ?? ONE_ON_ONE_VARIANT;
  const router = useRouter();
  const { t, language: uiLanguage } = useI18n();
  const startedRef = useRef(false);
  const spotlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const transcriptExitTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const transcriptLifetimeTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const meetingNoteLifetimeTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const thinkingStatusQueueRef = useRef<QueuedThinkingStatus[]>([]);
  const thinkingStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const interviewTransitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const interviewTransitionFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const preloadedInterviewSessionRef = useRef<string | null>(null);
  const transcriptExpiredKeysRef = useRef<Set<string>>(new Set());
  const [draft, setDraft] = useState<CouncilPageDraft | null>(null);
  const [speakers, setSpeakers] = useState<SpeakerState[]>([]);
  const [activeRole, setActiveRole] = useState<string | null>(null);
  const [spotlight, setSpotlight] = useState<CouncilTurn | null>(null);
  const [turns, setTurns] = useState<CouncilTurn[]>([]);
  const [transcriptItems, setTranscriptItems] = useState<TranscriptItem[]>([]);
  const [messages, setMessages] = useState<string[]>([]);
  const [meetingNotes, setMeetingNotes] = useState<MeetingNote[]>([]);
  const [thinkingStatus, setThinkingStatus] = useState<RoleThinkingStatus | null>(null);
  const [finalCouncil, setFinalCouncil] = useState<InterviewPlanCouncil | null>(null);
  const [focusAreas, setFocusAreas] = useState<string[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quickStarting, setQuickStarting] = useState(false);
  const [done, setDone] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(cfg.draftKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as CouncilPageDraft;
      setDraft(parsed);
      setSpeakers(defaultSpeakers(parsed.language, cfg.roles?.[parsed.language]));
    } catch {
      setDraft(null);
    }
  }, []);

  useEffect(() => () => {
    if (spotlightTimerRef.current) clearTimeout(spotlightTimerRef.current);
    transcriptExitTimersRef.current.forEach((timer) => clearTimeout(timer));
    transcriptLifetimeTimersRef.current.forEach((timer) => clearTimeout(timer));
    meetingNoteLifetimeTimersRef.current.forEach((timer) => clearTimeout(timer));
    if (thinkingStatusTimerRef.current) clearTimeout(thinkingStatusTimerRef.current);
    if (interviewTransitionTimerRef.current) clearTimeout(interviewTransitionTimerRef.current);
    if (interviewTransitionFallbackTimerRef.current) clearTimeout(interviewTransitionFallbackTimerRef.current);
  }, []);

  useEffect(() => {
    if (!draft || startedRef.current) return;
    startedRef.current = true;
    void runCouncil(draft);
  }, [draft]);

  const topics = useMemo(() => {
    if (finalCouncil?.consensus.priorityTopics.length) return finalCouncil.consensus.priorityTopics;
    return focusAreas.map((topic) => ({
      topic,
      priority: "medium" as const,
      reason: "",
      source: [] as ("jd" | "resume" | "risk" | "strategy")[],
    }));
  }, [finalCouncil, focusAreas]);
  const showDesignBrief = done || Boolean(finalCouncil) || focusAreas.length > 0;

  const targetTranscriptTurns = useMemo(() => {
    const entries = turns.map((turn, index) => ({ turn, index }));
    if (done) {
      const consensus = [...entries].reverse().find(({ turn }) => turn.phase === "consensus" || turn.phase === "fallback");
      return consensus ? [consensus] : entries.slice(-1);
    }
    return entries
      .filter(({ turn, index }) => !transcriptExpiredKeysRef.current.has(transcriptKey(turn, index)))
      .slice(-TRANSCRIPT_VISIBLE_TURNS);
  }, [done, turns]);

  const activeTranscriptKeys = useMemo(
    () => transcriptItems.filter((item) => !item.exiting).map((item) => item.key),
    [transcriptItems]
  );

  useEffect(() => {
    const targetKeys = new Set(targetTranscriptTurns.map(({ turn, index }) => transcriptKey(turn, index)));

    setTranscriptItems((previous) => {
      const previousByKey = new Map(previous.map((item) => [item.key, item]));
      const exitingItems = previous
        .filter((item) => !targetKeys.has(item.key))
        .map((item) => ({ ...item, exiting: true }));
      const visibleItems = targetTranscriptTurns.map(({ turn, index }) => {
        const key = transcriptKey(turn, index);
        const existing = previousByKey.get(key);
        return existing
          ? { ...existing, turn, index, exiting: false }
          : { key, turn, index, exiting: false };
      });
      return [...exitingItems, ...visibleItems];
    });

    const timer = setTimeout(() => {
      setTranscriptItems((items) =>
        items.some((item) => item.exiting) ? items.filter((item) => !item.exiting) : items
      );
    }, TRANSCRIPT_EXIT_MS);
    transcriptExitTimersRef.current.push(timer);
  }, [targetTranscriptTurns]);

  useEffect(() => {
    if (done) {
      transcriptLifetimeTimersRef.current.forEach((timer) => clearTimeout(timer));
      transcriptLifetimeTimersRef.current.clear();
      return;
    }

    targetTranscriptTurns.forEach(({ turn, index }) => {
      const key = transcriptKey(turn, index);
      if (transcriptLifetimeTimersRef.current.has(key)) return;
      const timer = setTimeout(() => {
        transcriptLifetimeTimersRef.current.delete(key);
        transcriptExpiredKeysRef.current.add(key);
        setTranscriptItems((items) =>
          items.map((item) => item.key === key ? { ...item, exiting: true } : item)
        );
        const removeTimer = setTimeout(() => {
          setTranscriptItems((items) => items.filter((item) => item.key !== key));
        }, TRANSCRIPT_EXIT_MS);
        transcriptExitTimersRef.current.push(removeTimer);
      }, TEMPORARY_NOTE_LIFETIME_MS);
      transcriptLifetimeTimersRef.current.set(key, timer);
    });
  }, [done, targetTranscriptTurns]);

  useEffect(() => {
    if (done) {
      meetingNoteLifetimeTimersRef.current.forEach((timer) => clearTimeout(timer));
      meetingNoteLifetimeTimersRef.current.clear();
      setMeetingNotes([]);
      return;
    }

    meetingNotes.forEach((note) => {
      if (note.exiting || meetingNoteLifetimeTimersRef.current.has(note.key)) return;
      const timer = setTimeout(() => {
        meetingNoteLifetimeTimersRef.current.delete(note.key);
        setMeetingNotes((items) =>
          items.map((item) => item.key === note.key ? { ...item, exiting: true } : item)
        );
        const removeTimer = setTimeout(() => {
          setMeetingNotes((items) => items.filter((item) => item.key !== note.key));
        }, TRANSCRIPT_EXIT_MS);
        transcriptExitTimersRef.current.push(removeTimer);
      }, TEMPORARY_NOTE_LIFETIME_MS);
      meetingNoteLifetimeTimersRef.current.set(note.key, timer);
    });
  }, [done, meetingNotes]);

  useEffect(() => {
    const transcript = transcriptRef.current;
    if (!transcript) return;
    const frame = requestAnimationFrame(() => {
      transcript.scrollTo({ top: transcript.scrollHeight, behavior: "smooth" });
    });
    return () => cancelAnimationFrame(frame);
  }, [transcriptItems.length, turns.length, meetingNotes.length, messages.length, done]);

  useEffect(() => {
    if (!sessionId || preloadedInterviewSessionRef.current === sessionId) return;
    preloadedInterviewSessionRef.current = sessionId;
    const target = `${cfg.sessionRoutePrefix}${encodeURIComponent(sessionId)}`;
    try {
      router.prefetch(target);
    } catch {
      // Prefetch is best-effort.
    }
    preloadInterviewAssets();
  }, [router, sessionId]);

  async function runCouncil(payload: CouncilPageDraft) {
    setError(null);
    setDone(false);
    try {
      const response = await fetch(cfg.streamEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Failed to start AI council");
      }
      if (!response.body) throw new Error("Streaming is not supported in this browser.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;
        buffer += decoder.decode(value, { stream: true });

        let splitIndex = buffer.indexOf("\n\n");
        while (splitIndex >= 0) {
          const chunk = buffer.slice(0, splitIndex);
          buffer = buffer.slice(splitIndex + 2);
          handleSseChunk(chunk);
          splitIndex = buffer.indexOf("\n\n");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI council failed");
    }
  }

  function handleSseChunk(chunk: string) {
    const lines = chunk.split("\n");
    const eventLine = lines.find((line) => line.startsWith("event:"));
    const dataLine = lines.find((line) => line.startsWith("data:"));
    const eventName = eventLine?.slice("event:".length).trim() || "message";
    const rawData = dataLine?.slice("data:".length).trim() || "{}";
    let data: StreamEvent;
    try {
      data = JSON.parse(rawData) as StreamEvent;
    } catch {
      return;
    }
    const type = data.type || eventName;

    if (type === "heartbeat") return;

    if (type === "session_preparing" || type === "council_started") {
      if (data.message) setMessages((items) => [...items, data.message as string]);
      if (data.message) {
        setThinkingStatus({ stage: data.stage, message: data.message, updatedAt: Date.now() });
      }
      return;
    }

    if (type === "thinking_status") {
      if (data.message) {
        const status: RoleThinkingStatus = {
          stage: data.stage,
          message: data.message,
          updatedAt: Date.now(),
        };
        enqueueThinkingStatus(data.role, status);
      }
      return;
    }

    if (type === "meeting_note") {
      if (data.message) {
        const role = data.role;
        const message = data.message;
        const createdAt = Date.now();
        const note: MeetingNote = {
          key: `${createdAt}-${role || "system"}-${data.stage || "note"}-${Math.random().toString(16).slice(2)}`,
          role,
          stage: data.stage,
          message,
          createdAt,
          exiting: false,
        };
        setMeetingNotes((items) => [...items, note]);
      }
      return;
    }

    if (type === "expert_started" || type === "critique_started" || type === "revision_started" || type === "review_started" || type === "consensus_started") {
      const role = data.role || t("councilPage.unknownRole");
      const phase = phaseForEvent(type);
      if (spotlightTimerRef.current) clearTimeout(spotlightTimerRef.current);
      setActiveRole(role);
      setThinkingStatus(null);
      setSpotlight({ role, phase, result: { conclusion: t("councilPage.thinking") } });
      setSpeakers((items) => markSpeaker(items, role, "speaking"));
      return;
    }

    if (type === "expert_completed" || type === "critique_completed" || type === "revision_completed" || type === "expert_skipped" || type === "review_completed") {
      const role = data.role || t("councilPage.unknownRole");
      const phase = phaseForEvent(type);
      const turn = { role, phase, result: compactResult(data.result) };
      clearQueuedThinkingStatuses(role);
      setSpotlight(turn);
      setTurns((items) => [...items, turn]);
      setSpeakers((items) => markSpeaker(items, role, "done", turn.result));
      setActiveRole(null);
      setThinkingStatus(null);
      if (spotlightTimerRef.current) clearTimeout(spotlightTimerRef.current);
      return;
    }

    if (type === "fallback_started") {
      const turn: CouncilTurn = {
        role: t("councilPage.consensusHost"),
        phase: "fallback",
        result: { conclusion: t("councilPage.fallback") },
      };
      if (spotlightTimerRef.current) clearTimeout(spotlightTimerRef.current);
      setSpotlight(turn);
      setTurns((items) => [...items, turn]);
      setThinkingStatus({ stage: "fallback", message: t("councilPage.fallback"), updatedAt: Date.now() });
      return;
    }

    if (type === "consensus_completed" || type === "fallback_completed") {
      if (data.plan?.council) {
        setFinalCouncil(data.plan.council);
        const log = buildResolutionLog(data.plan.council, turns);
        setSpeakers((items) => applyResolutionLog(items, log));
      }
      if (data.plan?.focusAreas) setFocusAreas(data.plan.focusAreas);
      const role = t("councilPage.consensusHost");
      const turn = {
        role,
        phase: "consensus" as const,
        result: {
          conclusion: data.plan?.council?.consensus.summary || t("councilPage.consensusDone"),
          focusAreas: data.plan?.focusAreas,
          predictedRisks: data.plan?.council?.consensus.predictedRisks,
          resolutionLog: buildResolutionLog(data.plan?.council, turns),
        },
      };
      setSpotlight(turn);
      setTurns((items) => [...items, turn]);
      setSpeakers((items) => markSpeaker(items, role, "done", turn.result));
      setActiveRole(null);
      setThinkingStatus(null);
      return;
    }

    if (type === "session_created") {
      setSessionId(data.sessionId || null);
      if (data.council) {
        const council = data.council as InterviewPlanCouncil;
        setFinalCouncil(council);
        const log = buildResolutionLog(council, turns);
        setSpeakers((items) => applyResolutionLog(items, log));
      }
      if (Array.isArray(data.focusAreas)) setFocusAreas(data.focusAreas as string[]);
      return;
    }

    if (type === "done") {
      setDone(true);
      setSpotlight((current) => current ?? {
          role: t("councilPage.consensusHost"),
          phase: "consensus",
          result: { conclusion: t("councilPage.consensusDone"), satisfied: true },
        });
      sessionStorage.removeItem(cfg.draftKey);
      return;
    }

    if (type === "error") {
      setError(data.error || "AI council failed");
    }
  }

  function resetCouncilState() {
    if (spotlightTimerRef.current) clearTimeout(spotlightTimerRef.current);
    transcriptExitTimersRef.current.forEach((timer) => clearTimeout(timer));
    transcriptExitTimersRef.current = [];
    transcriptLifetimeTimersRef.current.forEach((timer) => clearTimeout(timer));
    transcriptLifetimeTimersRef.current.clear();
    meetingNoteLifetimeTimersRef.current.forEach((timer) => clearTimeout(timer));
    meetingNoteLifetimeTimersRef.current.clear();
    if (thinkingStatusTimerRef.current) clearTimeout(thinkingStatusTimerRef.current);
    thinkingStatusTimerRef.current = null;
    thinkingStatusQueueRef.current = [];
    transcriptExpiredKeysRef.current.clear();
    setSpeakers(defaultSpeakers(draft?.language ?? "zh", cfg.roles?.[draft?.language ?? "zh"]));
    setActiveRole(null);
    setSpotlight(null);
    setTurns([]);
    setTranscriptItems([]);
    setMessages([]);
    setMeetingNotes([]);
    setThinkingStatus(null);
    setFinalCouncil(null);
    setFocusAreas([]);
    setSessionId(null);
    setError(null);
    setDone(false);
  }

  function enqueueThinkingStatus(role: string | undefined, status: RoleThinkingStatus) {
    thinkingStatusQueueRef.current.push({ role, status });
    pumpThinkingStatusQueue();
  }

  function pumpThinkingStatusQueue() {
    if (thinkingStatusTimerRef.current) return;
    const next = thinkingStatusQueueRef.current.shift();
    if (!next) return;

    applyThinkingStatus(next.role, next.status);

    const hasPendingStatus = thinkingStatusQueueRef.current.length > 0;
    if (next.status.stage !== "awaiting_model_result" || hasPendingStatus) {
      thinkingStatusTimerRef.current = setTimeout(() => {
        thinkingStatusTimerRef.current = null;
        pumpThinkingStatusQueue();
      }, THINKING_STATUS_MIN_DISPLAY_MS);
    }
  }

  function applyThinkingStatus(role: string | undefined, status: RoleThinkingStatus) {
    if (role) {
      setActiveRole(role);
    }
    setThinkingStatus(status);
    setMessages((items) => [...items, status.message]);
  }

  function clearQueuedThinkingStatuses(role?: string) {
    if (!role) {
      thinkingStatusQueueRef.current = [];
      return;
    }
    thinkingStatusQueueRef.current = thinkingStatusQueueRef.current.filter((item) => !sameCouncilRole(item.role, role));
  }

  function sameCouncilRole(left: string | undefined, right: string): boolean {
    if (!left) return false;
    const normalizedLeft = normalizeCouncilRole(left);
    const normalizedRight = normalizeCouncilRole(right);
    return normalizedLeft === normalizedRight ||
      normalizedLeft.includes(normalizedRight) ||
      normalizedRight.includes(normalizedLeft);
  }

  function normalizeCouncilRole(value: string): string {
    return value.toLowerCase().replace(/\s+/g, "");
  }

  function preloadInterviewAssets() {
    if (typeof window === "undefined") return;
    (cfg.preloadAssets ?? []).forEach((src) => {
      const image = new window.Image();
      image.decoding = "async";
      image.src = src;
    });
  }

  function retryCouncil() {
    if (!draft) return;
    resetCouncilState();
    startedRef.current = true;
    void runCouncil(draft);
  }

  async function startFastSession() {
    if (!draft || quickStarting) return;
    setQuickStarting(true);
    setError(null);
    try {
      const response = await fetch(cfg.fastEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg.buildFastBody(draft)),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to create interview");
      sessionStorage.removeItem(cfg.draftKey);
      router.push(`${cfg.sessionRoutePrefix}${data.sessionId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create interview");
      setQuickStarting(false);
    }
  }

  function enterInterviewWithTransition(nextSessionId: string) {
    if (leaving) return;
    const target = `${cfg.sessionRoutePrefix}${encodeURIComponent(nextSessionId)}`;
    preloadInterviewAssets();
    setLeaving(true);
    try {
      if (cfg.transitionKey) sessionStorage.setItem(cfg.transitionKey, "1");
      router.prefetch(target);
    } catch {
      // Storage/prefetch failures should never block the actual navigation.
    }
    interviewTransitionTimerRef.current = setTimeout(() => {
      router.push(target);
      interviewTransitionFallbackTimerRef.current = setTimeout(() => {
        if (window.location.pathname !== target) {
          window.location.assign(target);
        }
      }, 1400);
    }, 950);
  }

  if (!draft) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-10">
        <div className="rounded-3xl border bg-white p-8 text-sm text-slate-600 shadow-sm">
          <div>{t("councilPage.missingDraft")}</div>
          <button
            type="button"
            onClick={() => router.push("/?expanded=1")}
            className="mt-4 rounded-full bg-slate-950 px-5 py-2 text-sm font-medium text-white"
          >
            {t("setup.backHome")}
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className={`relative min-h-screen bg-[radial-gradient(circle_at_top_left,#fff7ed,transparent_34%),linear-gradient(135deg,#f8fafc,#eef6ff)] px-6 py-8 ${leaving ? "council-page-fade-out pointer-events-none" : ""}`}>
      {leaving && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-white/45">
          <div className="council-fade-in rounded-full border border-white/70 bg-white/90 px-5 py-2 text-sm font-medium text-slate-800 shadow-xl">
            {t("councilPage.transition.entering")}
          </div>
        </div>
      )}
      <div className="mx-auto max-w-6xl space-y-6">
        <section>
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.28em] text-amber-700">
                {t("councilPage.kicker")}
              </div>
              <h1 className="mt-3 text-3xl font-semibold text-slate-950">
                {t("councilPage.roundTableTitle")}
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                {t("councilPage.roundTableDesc")}
              </p>
            </div>
            <div className="text-sm text-slate-600 md:text-right">
              <div className="font-medium text-slate-900">{draft.company} · {draft.jobTitle}</div>
              <div className="mt-1 text-xs">{draft.modelId}</div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-4">
            <div className="rounded-[2rem] border border-white/70 bg-white/80 p-5 shadow-sm">
              <RoundTable
                speakers={speakers}
                activeRole={activeRole}
                spotlight={spotlight}
                thinkingStatus={thinkingStatus?.message ?? null}
                done={done}
                interviewLanguage={draft.language}
                onStart={done && sessionId ? () => enterInterviewWithTransition(sessionId) : undefined}
                expanded={done}
              />
            </div>
          </div>

          <div className="space-y-4">
            {showDesignBrief && (
              <CouncilDesignBrief
                council={finalCouncil}
                topics={topics}
                language={uiLanguage}
              />
            )}

            {!showDesignBrief && (
              <CouncilTranscriptPanel
                turnsLength={turns.length}
                transcriptItems={transcriptItems}
                activeTranscriptKeys={activeTranscriptKeys}
                meetingNotes={meetingNotes}
                messages={messages}
                transcriptRef={transcriptRef}
                uiLanguage={uiLanguage}
              />
            )}

            {error && (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                <div className="font-semibold">{t("councilPage.errorTitle")}</div>
                <div className="mt-1">{error}</div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={retryCouncil}
                    className="rounded-full border border-red-200 bg-white px-4 py-2 text-xs font-semibold text-red-700 hover:bg-red-100"
                  >
                    {t("councilPage.retry")}
                  </button>
                  <button
                    type="button"
                    onClick={startFastSession}
                    disabled={quickStarting}
                    className="rounded-full bg-slate-950 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    {quickStarting ? t("councilPage.quickStarting") : t("councilPage.quickStart")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
      <CouncilStyles />
    </main>
  );
}
