import assert from "node:assert/strict";
import test from "node:test";

import { easeOutCubic, interpolateCount } from "../src/lib/dashboard/count-up";

test("ticker lands exactly on the true value", () => {
  assert.equal(interpolateCount(0, 1465.37, 1), 1465.37);
  assert.equal(interpolateCount(2.43, 1.98, 1), 1.98);
});

test("ticker starts at the previous value", () => {
  assert.equal(interpolateCount(120, 400, 0), 120);
});

test("ticker never overshoots in either direction", () => {
  for (const [from, to] of [
    [0, 1000],
    [1000, 0],
    [-50, 50],
    [5, 5],
  ]) {
    for (let step = 0; step <= 100; step += 1) {
      const value = interpolateCount(from, to, step / 100);
      const low = Math.min(from, to);
      const high = Math.max(from, to);
      assert.ok(
        value >= low && value <= high,
        `${value} left [${low}, ${high}] at progress ${step / 100}`,
      );
    }
  }
});

test("progress outside 0-1 is clamped", () => {
  assert.equal(interpolateCount(10, 20, -3), 10);
  assert.equal(interpolateCount(10, 20, 4), 20);
});

test("easing decelerates rather than accelerates", () => {
  const firstHalf = easeOutCubic(0.5);
  assert.ok(firstHalf > 0.5, "ease-out should cover most ground early");
  assert.equal(easeOutCubic(0), 0);
  assert.equal(easeOutCubic(1), 1);
});
