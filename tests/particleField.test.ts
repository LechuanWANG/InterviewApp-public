import assert from "node:assert/strict";
import test from "node:test";
import {
  assignTargets,
  samplePointsFromAlpha,
  stepToward,
  type Point,
} from "../lib/home/particleField";

// Build an RGBA buffer (row-major) with the given fully-opaque pixels.
function rgbaWith(width: number, height: number, opaque: Array<[number, number]>): number[] {
  const data = new Array(width * height * 4).fill(0);
  for (const [x, y] of opaque) {
    data[(y * width + x) * 4 + 3] = 255;
  }
  return data;
}

test("samplePointsFromAlpha collects pixels at/above the alpha threshold", () => {
  const data = rgbaWith(4, 4, [
    [1, 1],
    [3, 0],
  ]);
  const points = samplePointsFromAlpha(data, 4, 4, 1, 128);
  assert.deepEqual(
    points.sort((a, b) => a.x - b.x || a.y - b.y),
    [
      { x: 1, y: 1 },
      { x: 3, y: 0 },
    ]
  );
});

test("samplePointsFromAlpha respects the sampling step", () => {
  // (1,1) is skipped when step=2 because only even coordinates are sampled.
  const data = rgbaWith(4, 4, [
    [1, 1],
    [2, 2],
  ]);
  const points = samplePointsFromAlpha(data, 4, 4, 2, 128);
  assert.deepEqual(points, [{ x: 2, y: 2 }]);
});

test("samplePointsFromAlpha ignores translucent pixels below threshold", () => {
  const data = new Array(2 * 2 * 4).fill(0);
  data[(0 * 2 + 0) * 4 + 3] = 100; // below 128 -> ignored
  data[(1 * 2 + 1) * 4 + 3] = 200; // above -> kept
  const points = samplePointsFromAlpha(data, 2, 2, 1, 128);
  assert.deepEqual(points, [{ x: 1, y: 1 }]);
});

test("assignTargets gives each target its nearest free source with no duplicates", () => {
  const sources: Point[] = [
    { x: 0, y: 0 },
    { x: 10, y: 10 },
  ];
  const targets: Point[] = [
    { x: 9, y: 9 },
    { x: 1, y: 1 },
  ];
  const assignment = assignTargets(sources, targets);
  assert.deepEqual(assignment, [1, 0]);
  const used = assignment.filter((i) => i >= 0);
  assert.equal(new Set(used).size, used.length);
});

test("assignTargets marks surplus targets as -1 when sources run out", () => {
  const sources: Point[] = [{ x: 0, y: 0 }];
  const targets: Point[] = [
    { x: 0, y: 1 },
    { x: 5, y: 5 },
  ];
  const assignment = assignTargets(sources, targets);
  assert.equal(assignment[0], 0);
  assert.equal(assignment[1], -1);
});

test("assignTargets never assigns one source to two targets", () => {
  const sources: Point[] = [
    { x: 0, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: 2 },
  ];
  const targets: Point[] = [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ];
  const assignment = assignTargets(sources, targets);
  assert.equal(new Set(assignment).size, 3); // three distinct sources
});

test("stepToward converges toward the target without overshooting", () => {
  let value = 0;
  for (let i = 0; i < 600; i++) value = stepToward(value, 100, 12, 1 / 60);
  assert.ok(Math.abs(value - 100) < 0.5, `expected ~100, got ${value}`);
  assert.ok(value <= 100, `should not overshoot, got ${value}`);
});

test("stepToward is monotonic and frame-rate stable", () => {
  let value = 0;
  let prev = -1;
  for (let i = 0; i < 50; i++) {
    value = stepToward(value, 100, 8, 1 / 60);
    assert.ok(value >= prev, "should move monotonically toward target");
    prev = value;
  }
  // A single huge dt must still not overshoot past the target.
  assert.ok(stepToward(0, 100, 8, 1000) <= 100);
});
