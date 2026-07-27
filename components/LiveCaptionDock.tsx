"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "./LanguageProvider";
import type { LiveAsrSnapshot } from "./VoiceRecorder";

export const LIVE_CAPTION_ENABLED_KEY = "interview-live-caption-enabled";

export function LiveCaptionDock({
  open,
  snapshot,
  onOpenChange,
}: {
  open: boolean;
  snapshot: LiveAsrSnapshot;
  onOpenChange: (open: boolean) => void;
}) {
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setPortalRoot(document.body);
  }, []);

  const { t } = useI18n();
  const text = (snapshot.text || snapshot.finalText || snapshot.interimText || "").trim();
  const hasError = snapshot.status === "error";
  const isLive = snapshot.status === "live";
  const isActive = snapshot.status === "connecting" || snapshot.status === "live";
  const captionLines = useMemo(() => liveCaptionLines(text), [text]);
  const animatedCaptionLines = useSlidingCaptionLines(captionLines);
  const buttonClass = !open
    ? "border-slate-200 bg-white text-slate-700"
    : hasError
      ? "border-red-200 bg-red-50 text-red-600"
      : isLive
        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
        : "border-slate-900 bg-slate-900 text-white";

  const dock = (
    <div className="fixed bottom-5 right-4 z-40 flex w-[min(22rem,calc(100vw-2rem))] flex-col items-end xl:bottom-auto xl:left-[calc(50%+24.5rem)] xl:right-8 xl:top-28 xl:w-auto">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label={open ? t("interview.liveCaptionClose") : t("interview.liveCaptionOpen")}
          aria-pressed={open}
          title={open ? t("interview.liveCaptionClose") : t("interview.liveCaptionOpen")}
          onClick={() => onOpenChange(!open)}
          className={`relative flex h-11 w-11 items-center justify-center rounded-full border text-[11px] font-semibold shadow-lg transition hover:scale-105 ${open && isActive ? "animate-pulse" : ""} ${buttonClass}`}
        >
          CC
          {open && isActive && (
            <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-white" />
          )}
        </button>
        {open && isActive && (
          <span className="rounded-full bg-white/90 px-2 py-1 text-[11px] font-medium text-emerald-700 shadow-sm">
            {t("interview.liveCaptionTranscribing")}
          </span>
        )}
      </div>

      {open && (
        <aside className="pointer-events-none absolute bottom-14 right-0 w-full text-right xl:static xl:mt-4">
          <div className="mb-2 flex items-center justify-end gap-2">
            <span className={`text-[11px] font-medium ${
              hasError
                ? "text-red-600"
                : snapshot.status === "live"
                  ? "text-emerald-700"
                  : "text-slate-500"
            }`}>
              {liveCaptionStatusLabel(snapshot.status, t)}
            </span>
          </div>
          <div className="relative h-48 w-full min-w-0 overflow-hidden text-sm leading-6 text-slate-900 drop-shadow-[0_1px_8px_rgba(255,255,255,0.95)]">
            {animatedCaptionLines.length > 0 ? (
              animatedCaptionLines.map((line) => (
                <p
                  key={line.id}
                  className="absolute left-0 right-0 m-0 overflow-visible whitespace-nowrap font-medium transition-[opacity,transform] duration-500 ease-out will-change-transform"
                  style={{
                    opacity: line.entering || line.exiting ? 0 : captionLineOpacity(line.index, captionLines.length),
                    transform: `translateY(${line.index * 2.35 + (line.entering ? 0.45 : line.exiting ? -0.35 : 0)}rem)`,
                    zIndex: line.exiting ? 0 : 1,
                  }}
                >
                  {line.text}
                </p>
              ))
            ) : (
              <p className="text-slate-400">{t("interview.liveCaptionEmpty")}</p>
            )}
          </div>
          {snapshot.error && (
            <div className="mt-2 text-xs leading-5 text-red-600">
              {snapshot.error}
            </div>
          )}
        </aside>
      )}
    </div>
  );

  return portalRoot ? createPortal(dock, portalRoot) : null;
}

type AnimatedCaptionLine = {
  id: string;
  text: string;
  index: number;
  entering: boolean;
  exiting: boolean;
};

function useSlidingCaptionLines(lines: string[]): AnimatedCaptionLine[] {
  const idRef = useRef(0);
  const cleanupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [items, setItems] = useState<AnimatedCaptionLine[]>([]);
  const lineKey = lines.join("\n");

  useEffect(() => {
    if (cleanupTimerRef.current) {
      clearTimeout(cleanupTimerRef.current);
      cleanupTimerRef.current = null;
    }
    if (enterTimerRef.current) {
      clearTimeout(enterTimerRef.current);
      enterTimerRef.current = null;
    }

    setItems((previous) => {
      const active = previous.filter((item) => !item.exiting);
      const usedIds = new Set<string>();
      const next = lines.map((line, index) => {
        let match = active.find((item) => item.text === line && !usedIds.has(item.id));
        if (!match && index === lines.length - 1) {
          match = [...active].reverse().find((item) =>
            !usedIds.has(item.id) && (line.startsWith(item.text) || item.text.startsWith(line))
          );
        }
        if (!match) {
          match = active.find((item) => item.index === index && !usedIds.has(item.id));
        }
        const id = match?.id ?? `caption-${++idRef.current}`;
        const isNew = !match;
        usedIds.add(id);
        return {
          id,
          text: line,
          index,
          entering: isNew,
          exiting: false,
        };
      });

      const nextIds = new Set(next.map((item) => item.id));
      const exiting = previous
        .filter((item) => !nextIds.has(item.id))
        .map((item) => ({ ...item, index: -1, entering: false, exiting: true }));

      return [...exiting, ...next];
    });

    enterTimerRef.current = setTimeout(() => {
      setItems((current) =>
        current.map((item) => item.entering ? { ...item, entering: false } : item)
      );
      enterTimerRef.current = null;
    }, 40);

    cleanupTimerRef.current = setTimeout(() => {
      setItems((current) => current.filter((item) => !item.exiting));
      cleanupTimerRef.current = null;
    }, 560);

    return () => {
      if (cleanupTimerRef.current) {
        clearTimeout(cleanupTimerRef.current);
        cleanupTimerRef.current = null;
      }
      if (enterTimerRef.current) {
        clearTimeout(enterTimerRef.current);
        enterTimerRef.current = null;
      }
    };
  }, [lineKey, lines]);

  return items;
}

function captionLineOpacity(index: number, total: number): number {
  if (index < 0) return 0;
  if (index === total - 1) return 1;
  if (index === total - 2) return 0.72;
  if (index === total - 3) return 0.42;
  return 0.2;
}

function liveCaptionLines(text: string): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const segments = normalized
    .split(/(?<=[。！？!?；;])\s*/)
    .map((item) => item.trim())
    .filter(Boolean);
  const lines = segments.flatMap((segment) => chunkCaptionText(segment, 15));
  return lines.slice(-5);
}

function chunkCaptionText(text: string, targetUnits: number): string[] {
  if (captionVisualLength(text) <= targetUnits) return [text];

  const lineCount = Math.ceil(captionVisualLength(text) / targetUnits);
  const balancedUnits = Math.ceil(captionVisualLength(text) / lineCount);
  const chunks: string[] = [];
  let current = "";
  let units = 0;

  for (const char of text) {
    const nextUnits = captionCharUnits(char);
    if (current && units + nextUnits > balancedUnits && !shouldKeepCaptionCharsTogether(current, char)) {
      chunks.push(current);
      current = "";
      units = 0;
    }
    current += char;
    units += nextUnits;
  }
  if (current) chunks.push(current);

  return chunks;
}

function shouldKeepCaptionCharsTogether(current: string, nextChar: string): boolean {
  const pair = `${current.at(-1) || ""}${nextChar}`;
  return /[，,、：:（(“"《]$/.test(current) ||
    ["因为", "但是", "所以", "如果", "而且", "其实", "非常", "这个", "那个", "我们", "你们", "他们"].includes(pair);
}

function captionVisualLength(text: string): number {
  let units = 0;
  for (const char of text) units += captionCharUnits(char);
  return units;
}

function captionCharUnits(char: string): number {
  if (/[\u4e00-\u9fff\u3040-\u30ff\uff00-\uffef]/.test(char)) return 1;
  if (/\s/.test(char)) return 0.35;
  return 0.58;
}

function liveCaptionStatusLabel(
  status: LiveAsrSnapshot["status"],
  t: (key: string, vars?: Record<string, string | number>) => string
): string {
  if (status === "connecting") return t("interview.liveCaptionConnecting");
  if (status === "live") return t("interview.liveCaptionLive");
  if (status === "error") return t("interview.liveCaptionUnavailable");
  if (status === "closed") return t("interview.liveCaptionClosed");
  return t("interview.liveCaptionIdle");
}

export function emptyLiveCaption(): LiveAsrSnapshot {
  return {
    status: "idle",
    text: "",
    finalText: "",
    interimText: "",
  };
}
