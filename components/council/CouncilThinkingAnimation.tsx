import type { CouncilTurn } from "./types";
import { useI18n } from "../LanguageProvider";

export function CouncilThinkingAnimation({
  role,
  phase,
  status,
}: {
  role: string;
  phase: CouncilTurn["phase"];
  status?: string | null;
}) {
  const { t } = useI18n();
  const variant = councilThinkingVariant(role, phase);
  const displayStatus = status || t("councilPage.thinking");

  return (
    <div className="relative flex flex-col items-center justify-center" aria-live="polite">
      <div className="relative flex h-28 w-28 items-center justify-center" aria-hidden="true">
        <ThinkingFrame frame={variant.frame} tone={variant.frameTone} />
        <div className={`relative flex h-16 w-16 items-center justify-center ${variant.tone}`}>
          <ThinkingGlyph variant={variant.kind} />
        </div>
      </div>
      <div className="relative mt-3 h-10 w-56 overflow-hidden text-center">
        <div
          key={`${role}-${phase}-${displayStatus}`}
          className="council-thinking-hint text-xs font-medium leading-5 text-slate-600"
        >
          {displayStatus}
        </div>
      </div>
    </div>
  );
}

type CouncilThinkingKind = "jd" | "resume" | "strategy" | "risk" | "host";
type CouncilThinkingFrame = "circle" | "diamond" | "triangle" | "shield" | "dots";

function councilThinkingVariant(role: string, phase: CouncilTurn["phase"]): {
  kind: CouncilThinkingKind;
  frame: CouncilThinkingFrame;
  frameTone: string;
  tone: string;
} {
  const kind = councilThinkingKind(role, phase);
  if (kind === "jd") {
    return {
      kind,
      frame: "circle",
      frameTone: "text-sky-500",
      tone: "text-sky-700 drop-shadow-[0_0_10px_rgba(14,165,233,0.22)]",
    };
  }
  if (kind === "resume") {
    return {
      kind,
      frame: "diamond",
      frameTone: "text-emerald-500",
      tone: "text-emerald-700 drop-shadow-[0_0_10px_rgba(16,185,129,0.22)]",
    };
  }
  if (kind === "strategy") {
    return {
      kind,
      frame: "triangle",
      frameTone: "text-orange-500",
      tone: "text-orange-700 drop-shadow-[0_0_10px_rgba(249,115,22,0.22)]",
    };
  }
  if (kind === "risk") {
    return {
      kind,
      frame: "shield",
      frameTone: "text-rose-500",
      tone: "text-rose-700 drop-shadow-[0_0_10px_rgba(244,63,94,0.22)]",
    };
  }
  return {
    kind,
    frame: "dots",
    frameTone: "text-indigo-500",
    tone: "text-indigo-700 drop-shadow-[0_0_10px_rgba(99,102,241,0.22)]",
  };
}

function councilThinkingKind(role: string, phase: CouncilTurn["phase"]): CouncilThinkingKind {
  const normalized = role.toLowerCase().replace(/\s+/g, "");
  if (normalized.includes("jd解构官") || normalized.includes("jdanalyst")) return "jd";
  if (normalized.includes("简历深挖官") || normalized.includes("resume")) return "resume";
  if (normalized.includes("面试策略官") || normalized.includes("题目设计官") || normalized.includes("strategy") || normalized.includes("topicdesigner")) return "strategy";
  if (normalized.includes("风险质疑官") || normalized.includes("risk")) return "risk";
  if (phase === "consensus" || normalized.includes("主持人") || normalized === "host") return "host";
  return "host";
}

function ThinkingFrame({ frame, tone }: { frame: CouncilThinkingFrame; tone: string }) {
  const baseClass = `absolute inset-0 h-full w-full ${tone}`;

  if (frame === "diamond") {
    return (
      <svg className={baseClass} viewBox="0 0 112 112">
        <polygon points="56 9 103 56 56 103 9 56" fill="none" stroke="currentColor" strokeWidth="1.7" opacity="0.24" />
        <polygon className="council-thinking-frame-accent" points="56 9 103 56 56 103 9 56" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="3" />
        <polygon points="56 23 89 56 56 89 23 56" fill="none" stroke="currentColor" strokeWidth="1.3" opacity="0.16" />
      </svg>
    );
  }

  if (frame === "triangle") {
    return (
      <svg className={baseClass} viewBox="0 0 112 112">
        <polygon points="56 101 13 22 99 22" fill="none" stroke="currentColor" strokeWidth="1.7" opacity="0.25" />
        <polygon className="council-thinking-frame-accent" points="56 101 13 22 99 22" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="3" />
        <path d="M56 82 L30 34 H82 Z" fill="none" stroke="currentColor" strokeWidth="1.3" opacity="0.16" />
      </svg>
    );
  }

  if (frame === "shield") {
    return (
      <svg className={baseClass} viewBox="0 0 112 112">
        <path d="M56 8 L94 23 V51 C94 77 78 94 56 104 C34 94 18 77 18 51 V23 L56 8Z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.7" opacity="0.24" />
        <path className="council-thinking-frame-accent" d="M56 8 L94 23 V51 C94 77 78 94 56 104 C34 94 18 77 18 51 V23 L56 8Z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="3" />
        <path d="M56 23 L80 33 V53 C80 70 70 82 56 90 C42 82 32 70 32 53 V33 L56 23Z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.3" opacity="0.16" />
      </svg>
    );
  }

  if (frame === "dots") {
    return (
      <svg className={baseClass} viewBox="0 0 112 112">
        <g className="council-thinking-dot-orbit">
          <circle cx="56" cy="10" r="3.8" fill="currentColor" opacity="0.72" />
          <circle cx="96" cy="56" r="3.2" fill="currentColor" opacity="0.48" />
          <circle cx="56" cy="102" r="2.8" fill="currentColor" opacity="0.34" />
          <circle cx="16" cy="56" r="3.2" fill="currentColor" opacity="0.48" />
        </g>
        <path className="council-thinking-host-weave" d="M35 60 C44 45, 68 45, 77 60" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.2" opacity="0.42" />
        <path className="council-thinking-host-weave council-thinking-host-weave-delay" d="M35 52 C44 67, 68 67, 77 52" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.2" opacity="0.32" />
      </svg>
    );
  }

  return (
    <svg className={baseClass} viewBox="0 0 112 112">
      <circle cx="56" cy="56" r="49" fill="none" stroke="currentColor" strokeWidth="1.7" opacity="0.24" />
      <circle className="council-thinking-frame-accent" cx="56" cy="56" r="49" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="3" />
      <circle cx="56" cy="56" r="35" fill="none" stroke="currentColor" strokeWidth="1.3" opacity="0.16" />
    </svg>
  );
}

function ThinkingGlyph({ variant }: { variant: CouncilThinkingKind }) {
  if (variant === "jd") {
    return (
      <svg className="h-11 w-11" viewBox="0 0 44 44">
        <path d="M10 14 H34" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.6" opacity="0.7" />
        <path d="M10 22 H28" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.6" opacity="0.5" />
        <path d="M10 30 H33" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.6" opacity="0.35" />
        <path className="council-thinking-scan-line" d="M8 8 H36" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="3" opacity="0.65" />
      </svg>
    );
  }
  if (variant === "resume") {
    return (
      <svg className="h-11 w-11" viewBox="0 0 44 44">
        <circle cx="17" cy="17" r="5" fill="currentColor" opacity="0.58" />
        <path d="M8 32 C10.5 25, 23.5 25, 26 32" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="3" opacity="0.42" />
        <path d="M29 15 H36" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.4" opacity="0.6" />
        <path d="M30 23 H37" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.4" opacity="0.42" />
        <path className="council-thinking-scan-line" d="M7 8 H37" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="3" opacity="0.55" />
      </svg>
    );
  }
  if (variant === "strategy") {
    return (
      <svg className="h-11 w-11" viewBox="0 0 44 44">
        <path className="council-thinking-path" d="M9 32 C15 16, 26 31, 35 12" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.5" />
        <circle cx="9" cy="32" r="3.5" fill="currentColor" opacity="0.45" />
        <circle cx="22" cy="22" r="3.5" fill="currentColor" opacity="0.65" />
        <circle cx="35" cy="12" r="3.5" fill="currentColor" />
      </svg>
    );
  }
  if (variant === "risk") {
    return (
      <svg className="h-11 w-11" viewBox="0 0 44 44">
        <path d="M22 5 L34 10 V20 C34 29 28 35 22 39 C16 35 10 29 10 20 V10 L22 5Z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="2.4" />
        <path className="council-thinking-alert" d="M22 14 V24" stroke="currentColor" strokeLinecap="round" strokeWidth="2.6" />
        <circle cx="22" cy="29" r="1.8" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg className="h-12 w-12" viewBox="0 0 48 48">
      <path className="council-thinking-host-weave" d="M10 28 C16 14, 32 14, 38 28" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.4" opacity="0.62" />
      <path className="council-thinking-host-weave council-thinking-host-weave-delay" d="M10 20 C16 34, 32 34, 38 20" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.4" opacity="0.44" />
      <circle className="council-thinking-host-node" cx="10" cy="24" r="3.2" fill="currentColor" opacity="0.46" />
      <circle className="council-thinking-host-node council-thinking-host-node-delay" cx="24" cy="17" r="3.2" fill="currentColor" opacity="0.72" />
      <circle className="council-thinking-host-node" cx="38" cy="24" r="3.2" fill="currentColor" opacity="0.46" />
      <circle className="council-thinking-host-node council-thinking-host-node-delay" cx="24" cy="32" r="2.6" fill="currentColor" opacity="0.38" />
    </svg>
  );
}
