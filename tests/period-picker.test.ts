import assert from "node:assert/strict";
import test from "node:test";

import {
  addDays,
  addMonths,
  buildMonthGrid,
  endOfMonth,
  formatCalendarDate,
  inclusiveDays,
  isWithinRange,
  startOfMonth,
  startOfWeek,
} from "../src/lib/dashboard/calendar";
import {
  COMPARISON_WINDOW_LABELS,
  normaliseComparisonWindow,
  resolveComparisonRange,
  type ComparisonWindow,
} from "../src/lib/dashboard/search-terms";
import {
  currentDateInTimeZone,
  matchTimeframe,
  PREVIEW_REFERENCE_DATE,
  resolveTimeframe,
  TIMEFRAME_PRESETS,
} from "../src/lib/dashboard/timeframes";
import { MAX_RANGE_DAYS } from "../src/lib/dashboard/validation";
import { buildDashboardSnapshot } from "../src/lib/dashboard/fixtures";

test("calendar arithmetic stays in UTC and clamps short months", () => {
  assert.equal(addDays("2026-07-14", -13), "2026-07-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  // 31 January minus one month has no 31st to land on.
  assert.equal(addMonths("2026-03-31", -1), "2026-02-28");
  assert.equal(addMonths("2026-12-15", 1), "2027-01-15");
  assert.equal(startOfMonth("2026-07-14"), "2026-07-01");
  assert.equal(endOfMonth("2026-02-10"), "2026-02-28");
  assert.equal(endOfMonth("2024-02-10"), "2024-02-29");
});

test("weeks start on Sunday so the grid header matches the cells", () => {
  // 14 July 2026 is a Tuesday; its week starts on Sunday 12 July.
  assert.equal(startOfWeek("2026-07-14"), "2026-07-12");
  assert.equal(startOfWeek("2026-07-12"), "2026-07-12");
});

test("a month grid holds whole weeks and only its own days", () => {
  const july = buildMonthGrid("2026-07-01");

  assert.equal(
    july.every((week) => week.length === 7),
    true,
  );
  // July 2026 starts on a Wednesday, so the first three cells are blank.
  assert.deepEqual(july[0].slice(0, 3), [null, null, null]);
  assert.equal(july[0][3], "2026-07-01");

  const days = july.flat().filter((day): day is string => day !== null);
  assert.equal(days.length, 31);
  assert.equal(
    days.every((day) => day.startsWith("2026-07")),
    true,
  );
});

test("range helpers count inclusively", () => {
  assert.equal(inclusiveDays({ start: "2026-07-01", end: "2026-07-14" }), 14);
  assert.equal(inclusiveDays({ start: "2026-07-14", end: "2026-07-14" }), 1);
  assert.equal(
    isWithinRange("2026-07-01", { start: "2026-07-01", end: "2026-07-14" }),
    true,
  );
  assert.equal(
    isWithinRange("2026-06-30", { start: "2026-07-01", end: "2026-07-14" }),
    false,
  );
  assert.equal(formatCalendarDate("2026-07-01"), "1 Jul 2026");
});

test("the Meta-shaped presets resolve against the reference day", () => {
  assert.deepEqual(resolveTimeframe("today"), {
    start: PREVIEW_REFERENCE_DATE,
    end: PREVIEW_REFERENCE_DATE,
  });
  assert.deepEqual(resolveTimeframe("yesterday"), {
    start: "2026-07-13",
    end: "2026-07-13",
  });
  assert.deepEqual(resolveTimeframe("28d"), {
    start: "2026-06-17",
    end: PREVIEW_REFERENCE_DATE,
  });
  // The running week and month stop at the reference day.
  assert.deepEqual(resolveTimeframe("this-week"), {
    start: "2026-07-12",
    end: PREVIEW_REFERENCE_DATE,
  });
  assert.deepEqual(resolveTimeframe("last-week"), {
    start: "2026-07-05",
    end: "2026-07-11",
  });
  assert.deepEqual(resolveTimeframe("this-month"), {
    start: "2026-07-01",
    end: PREVIEW_REFERENCE_DATE,
  });
  assert.deepEqual(resolveTimeframe("last-month"), {
    start: "2026-06-01",
    end: "2026-06-30",
  });
  assert.deepEqual(resolveTimeframe("all-time"), {
    start: "2024-01-01",
    end: PREVIEW_REFERENCE_DATE,
  });
});

test("the running date follows the reporting timezone and stops on 11 August", () => {
  const instant = new Date("2026-08-11T06:30:00.000Z");

  assert.equal(currentDateInTimeZone("Asia/Makassar", instant), "2026-08-11");
  assert.equal(currentDateInTimeZone("Europe/London", instant), "2026-08-11");
  assert.equal(currentDateInTimeZone("America/Los_Angeles", instant), "2026-08-10");
  assert.deepEqual(resolveTimeframe("today", "2026-08-11"), {
    start: "2026-08-11",
    end: "2026-08-11",
  });
  assert.deepEqual(resolveTimeframe("yesterday", "2026-08-11"), {
    start: "2026-08-10",
    end: "2026-08-10",
  });
  assert.deepEqual(resolveTimeframe("14d", "2026-08-11"), {
    start: "2026-07-29",
    end: "2026-08-11",
  });
  assert.deepEqual(resolveTimeframe("this-month", "2026-08-11"), {
    start: "2026-08-01",
    end: "2026-08-11",
  });
  assert.deepEqual(resolveTimeframe("all-time", "2026-08-11"), {
    start: "2024-01-01",
    end: "2026-08-11",
  });
});

test("no preset resolves to a range the dashboard would refuse to query", () => {
  for (const preset of TIMEFRAME_PRESETS) {
    const range = resolveTimeframe(preset.key);
    assert.notEqual(range, null, `${preset.key} did not resolve`);
    if (!range) continue;
    assert.equal(
      inclusiveDays(range) <= MAX_RANGE_DAYS,
      true,
      `${preset.key} is too long`,
    );
  }
});

test("every preset round-trips through matchTimeframe to a stable label", () => {
  for (const preset of TIMEFRAME_PRESETS) {
    const range = resolveTimeframe(preset.key);
    if (!range) continue;
    const matched = matchTimeframe(range);
    assert.notEqual(matched, null);
    // A collision is allowed, but only onto a preset with identical dates.
    assert.deepEqual(resolveTimeframe(matched as string), range);
  }
});

test("the previous-cycle baseline is the whole 30-day cycle before it", () => {
  // Reporting cycles are anchored to 2026-03-27 and run 30 days each, so
  // the baseline for a period inside 24 Aug - 22 Sep is 25 Jul - 23 Aug.
  assert.deepEqual(
    resolveComparisonRange(
      { start: "2026-08-24", end: "2026-09-14" },
      "previous-cycle",
    ),
    { start: "2026-07-25", end: "2026-08-23" },
  );
  // It is anchored to the cycle the period ENDS in, matching how the budget
  // card resolves its own cycle from the same screen.
  assert.deepEqual(
    resolveComparisonRange(
      { start: "2026-08-20", end: "2026-08-26" },
      "previous-cycle",
    ),
    { start: "2026-07-25", end: "2026-08-23" },
  );
  // No calendar month can appear: every baseline is exactly 30 days.
  const baseline = resolveComparisonRange(
    { start: "2026-07-01", end: "2026-07-14" },
    "previous-cycle",
  );
  const days =
    (Date.parse(`${baseline.end}T00:00:00Z`)
      - Date.parse(`${baseline.start}T00:00:00Z`))
      / 86_400_000
    + 1;
  assert.equal(days, 30);
});

test("a saved link using the retired calendar-month value resolves to the cycle", () => {
  assert.equal(normaliseComparisonWindow("previous-month"), "previous-cycle");
  assert.equal(normaliseComparisonWindow("previous-year"), "previous-year");
  assert.equal(normaliseComparisonWindow("nonsense"), undefined);
  assert.equal(normaliseComparisonWindow(null), undefined);
});

test("a custom baseline is honoured, and its absence falls back honestly", () => {
  const custom = { start: "2025-07-01", end: "2025-07-14" };

  assert.deepEqual(
    resolveComparisonRange(
      { start: "2026-07-01", end: "2026-07-14" },
      "custom",
      custom,
    ),
    custom,
  );
  // Without dates the window cannot report against nothing, so it reads as
  // the equal-length previous period instead.
  assert.deepEqual(
    resolveComparisonRange({ start: "2026-07-01", end: "2026-07-14" }, "custom"),
    { start: "2026-06-17", end: "2026-06-30" },
  );
});

test("every comparison window is labelled and resolves to a valid range", () => {
  const range = { start: "2026-07-01", end: "2026-07-14" };

  for (const window of Object.keys(
    COMPARISON_WINDOW_LABELS,
  ) as ComparisonWindow[]) {
    const resolved = resolveComparisonRange(range, window);
    assert.equal(typeof COMPARISON_WINDOW_LABELS[window], "string");
    assert.equal(resolved.start <= resolved.end, true, window);
    assert.equal(resolved.end < range.start || window === "custom", true, window);
  }
});

test("compare off withholds every period-over-period figure", () => {
  const range = { start: "2026-07-01", end: "2026-07-14" };
  const on = buildDashboardSnapshot(range, "all");
  const off = buildDashboardSnapshot(
    range,
    "all",
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    false,
  );

  assert.equal(on.comparisonEnabled, true);
  assert.equal(off.comparisonEnabled, false);
  assert.equal(off.comparisonBasis.label, "No comparison");

  // No card may keep a baseline, so every delta renders as unavailable.
  assert.equal(
    on.cards.some((card) => card.previousValue !== null),
    true,
  );
  assert.equal(
    off.cards.every((card) => card.previousValue === null),
    true,
  );

  // The verdict reads the same cards, so it stops claiming movement.
  assert.equal(off.snapshotSummary.biggestImprovement, null);
  assert.equal(off.snapshotSummary.biggestDrag, null);
  assert.equal(
    off.summary.whatHappened.some((line) => line.includes("Comparison is switched off")),
    true,
  );

  // The current period itself is untouched.
  assert.deepEqual(off.totals, on.totals);
  assert.deepEqual(off.selectedRange, range);
});

test("a custom baseline reaches the snapshot and its stated basis", () => {
  const range = { start: "2026-07-01", end: "2026-07-14" };
  const snapshot = buildDashboardSnapshot(
    range,
    "all",
    undefined,
    undefined,
    undefined,
    undefined,
    "custom",
    { start: "2025-07-01", end: "2025-07-14" },
  );

  assert.deepEqual(snapshot.comparisonRange, {
    start: "2025-07-01",
    end: "2025-07-14",
  });
  assert.equal(snapshot.comparisonBasis.label, "Custom period");
  assert.equal(snapshot.comparisonBasis.normalisedToActiveDuration, false);
  assert.deepEqual(snapshot.geo?.comparisonRange, {
    start: "2025-07-01",
    end: "2025-07-14",
  });
  assert.equal(snapshot.searchTerms?.comparisonRange.start, "2025-07-01");
});
