import type { ReactNode } from "react";

type SpinnerSize = "sm" | "md" | "lg";

const SPINNER_DIMENSIONS: Record<SpinnerSize, { ring: string; core: string }> = {
  sm: { ring: "h-5 w-5", core: "inset-[3px]" },
  md: { ring: "h-9 w-9", core: "inset-[5px]" },
  lg: { ring: "h-12 w-12", core: "inset-[7px]" },
};

/**
 * Dual-ring spinner with a soft pulsing core. Inherits no text color so it can
 * sit on light surfaces; the spinning ring is emerald (consult board) and the
 * pulsing core is violet (interview board), pairing both sections' accents.
 */
export function LoadingSpinner({ size = "md" }: { size?: SpinnerSize }) {
  const dims = SPINNER_DIMENSIONS[size];
  return (
    <span className={`relative inline-flex shrink-0 ${dims.ring}`} aria-hidden="true">
      <span className="absolute inset-0 rounded-full border-2 border-slate-200/80" />
      <span className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-emerald-500 border-r-emerald-500" />
      <span className={`absolute ${dims.core} animate-pulse rounded-full bg-violet-500/10`} />
    </span>
  );
}

/**
 * Three bouncing dots that inherit the current text color — meant to live inside
 * buttons (e.g. "生成中…") next to a label.
 */
export function LoadingDots({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 ${className}`} aria-hidden="true">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.2s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.1s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current" />
    </span>
  );
}

/**
 * Primary loading affordance. Use `variant="block"` for page-level / in-place
 * loading (centered spinner with a shimmering label) and `variant="inline"` for
 * a compact spinner + label that flows with surrounding content.
 */
export default function LoadingIndicator({
  label,
  variant = "block",
  size,
  className = "",
}: {
  label?: ReactNode;
  variant?: "block" | "inline";
  size?: SpinnerSize;
  className?: string;
}) {
  if (variant === "inline") {
    return (
      <span
        role="status"
        aria-live="polite"
        className={`inline-flex items-center gap-2.5 text-sm text-slate-500 ${className}`}
      >
        <LoadingSpinner size={size ?? "sm"} />
        {label != null && <span className="loading-shimmer-text font-medium">{label}</span>}
      </span>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex flex-col items-center justify-center gap-3 py-10 text-center ${className}`}
    >
      <LoadingSpinner size={size ?? "md"} />
      {label != null && <span className="loading-shimmer-text text-sm font-medium">{label}</span>}
    </div>
  );
}
