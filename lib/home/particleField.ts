// Pure geometry/easing helpers for the home backdrop particle field.
// Kept free of canvas/DOM APIs so the tricky math stays unit-testable.

export type Point = { x: number; y: number };

/**
 * Sample points from an RGBA buffer (as returned by `getImageData`) on a grid,
 * keeping coordinates whose alpha channel meets the threshold. Used to turn a
 * rendered word into a cloud of target points the particles fly toward.
 */
export function samplePointsFromAlpha(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  step: number,
  threshold = 128
): Point[] {
  const points: Point[] = [];
  const s = Math.max(1, Math.floor(step));
  for (let y = 0; y < height; y += s) {
    for (let x = 0; x < width; x += s) {
      if (rgba[(y * width + x) * 4 + 3] >= threshold) {
        points.push({ x, y });
      }
    }
  }
  return points;
}

function distanceSq(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/**
 * Greedily assign each target the nearest still-free source. Returns an array
 * parallel to `targets`, where each entry is the chosen index into `sources`
 * (or -1 when sources are exhausted). No source is used twice.
 */
export function assignTargets(sources: Point[], targets: Point[]): number[] {
  const used = new Array<boolean>(sources.length).fill(false);
  const assignment = new Array<number>(targets.length).fill(-1);

  for (let t = 0; t < targets.length; t++) {
    let best = -1;
    let bestDist = Infinity;
    for (let s = 0; s < sources.length; s++) {
      if (used[s]) continue;
      const d = distanceSq(sources[s], targets[t]);
      if (d < bestDist) {
        bestDist = d;
        best = s;
      }
    }
    if (best >= 0) {
      used[best] = true;
      assignment[t] = best;
    }
  }
  return assignment;
}

/**
 * Frame-rate-independent exponential easing toward a target. The smoothing
 * factor is derived from `dt` so motion is stable regardless of frame timing,
 * and it never overshoots (the step fraction stays within [0, 1)).
 */
export function stepToward(
  current: number,
  target: number,
  smoothing: number,
  dt: number
): number {
  const factor = 1 - Math.exp(-Math.max(0, smoothing) * Math.max(0, dt));
  return current + (target - current) * factor;
}
