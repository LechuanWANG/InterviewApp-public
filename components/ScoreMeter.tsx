const SCORE_MAX = 9;
const SCORE_GRADIENT = "linear-gradient(90deg, #dbeafe 0%, #93c5fd 42%, #2563eb 100%)";

function clampPercent(value: number, max = SCORE_MAX): number {
  if (!Number.isFinite(value) || max <= 0) return 0;
  return Math.min(100, Math.max(0, (value / max) * 100));
}

export function DimensionScoreMeter({
  value,
  max = SCORE_MAX,
  label,
}: {
  value: number;
  max?: number;
  label?: string;
}) {
  const percent = clampPercent(value, max);

  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Number.isFinite(value) ? value : 0}
      className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-blue-50 shadow-inner ring-1 ring-blue-100/80"
    >
      <div
        className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ease-out"
        style={{
          width: `${percent}%`,
          background: SCORE_GRADIENT,
          boxShadow: "0 4px 14px rgba(37, 99, 235, 0.2)",
        }}
      >
        <span className="absolute inset-x-0 top-0 h-1/2 rounded-full bg-white/35" />
      </div>
    </div>
  );
}

export function CollaborationScoreMeter({
  value,
  max = SCORE_MAX,
  label,
}: {
  value: number;
  max?: number;
  label?: string;
}) {
  const percent = clampPercent(value, max);
  const markerPercent = Math.min(98, Math.max(2, percent));

  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Number.isFinite(value) ? value : 0}
      className="relative h-4 flex-1 overflow-hidden rounded-full bg-blue-50 shadow-inner ring-1 ring-blue-100"
    >
      <div
        className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ease-out"
        style={{
          width: `${percent}%`,
          background: SCORE_GRADIENT,
          boxShadow: "0 8px 20px rgba(37, 99, 235, 0.24)",
        }}
      >
        <span className="absolute inset-x-0 top-0 h-1/2 rounded-full bg-white/35" />
      </div>
      <div
        className="pointer-events-none absolute inset-y-0 left-0 right-0"
        style={{
          backgroundImage:
            "linear-gradient(90deg, transparent calc(20% - 1px), rgba(30, 64, 175, 0.16) calc(20% - 1px), rgba(30, 64, 175, 0.16) 20%, transparent 20%)",
          backgroundSize: "20% 100%",
        }}
      />
      <span
        className="absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-blue-700 shadow-md transition-[left] duration-500 ease-out"
        style={{ left: `${markerPercent}%` }}
        aria-hidden="true"
      />
    </div>
  );
}
