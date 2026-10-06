import {
  addDays,
  addMonths,
  endOfMonth,
  monthLabel,
  startOfMonth,
  startOfWeek,
} from "@/lib/dashboard/calendar";
import type { DateRange } from "@/lib/dashboard/types";

/**
 * Deterministic fallback for isolated previews and tests. Application routes
 * pass the account's actual current day explicitly.
 */
export const PREVIEW_REFERENCE_DATE = "2026-07-14";

/** Returns an ISO calendar day in the reporting account's timezone. */
export function currentDateInTimeZone(
  timeZone: string,
  now: Date = new Date(),
): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    calendar: "gregory",
    day: "2-digit",
    month: "2-digit",
    numberingSystem: "latn",
    timeZone,
    year: "numeric",
  }).formatToParts(now);
  const valueFor = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  const year = valueFor("year");
  const month = valueFor("month");
  const day = valueFor("day");

  if (!year || !month || !day) {
    throw new Error(`Unable to resolve the current date for ${timeZone}.`);
  }

  return `${year}-${month}-${day}`;
}

export interface TimeframePreset {
  key: string;
  label: string;
  group: "Rolling" | "Calendar" | "Calendar year";
}

/**
 * Order matters twice: it is the order the picker lists presets in, and
 * `matchTimeframe` returns the first preset a range matches. Where two presets
 * can resolve to the same range on a given reference day — "today" and "this
 * week" on a Sunday — the earlier entry wins and is the label the reader sees.
 */
export const TIMEFRAME_PRESETS: TimeframePreset[] = [
  { key: "today", label: "Today", group: "Rolling" },
  { key: "yesterday", label: "Yesterday", group: "Rolling" },
  { key: "7d", label: "Last 7 days", group: "Rolling" },
  { key: "14d", label: "Last 14 days", group: "Rolling" },
  { key: "28d", label: "Last 28 days", group: "Rolling" },
  { key: "30d", label: "Last 30 days", group: "Rolling" },
  { key: "90d", label: "Last 90 days", group: "Rolling" },
  { key: "180d", label: "Last 180 days", group: "Rolling" },
  { key: "1y", label: "Last 12 months", group: "Rolling" },
  { key: "all-time", label: "All time", group: "Rolling" },
  { key: "this-week", label: "This week", group: "Calendar" },
  { key: "last-week", label: "Last week", group: "Calendar" },
  { key: "this-month", label: "This month", group: "Calendar" },
  { key: "last-month", label: "Last month", group: "Calendar" },
  { key: "2026", label: "2026", group: "Calendar year" },
  { key: "2025", label: "2025", group: "Calendar year" },
  { key: "2024", label: "2024", group: "Calendar year" },
];

const ROLLING_DAYS: Record<string, number> = {
  "7d": 7,
  "14d": 14,
  "28d": 28,
  "30d": 30,
  "90d": 90,
  "180d": 180,
  "1y": 365,
};

export function resolveTimeframe(
  key: string,
  referenceDate: string = PREVIEW_REFERENCE_DATE,
): DateRange | null {
  const rollingDays = ROLLING_DAYS[key];
  if (rollingDays !== undefined) {
    return {
      start: addDays(referenceDate, -(rollingDays - 1)),
      end: referenceDate,
    };
  }

  if (key === "all-time") {
    const earliest = "2024-01-01";
    return {
      start: referenceDate < earliest ? referenceDate : earliest,
      end: referenceDate,
    };
  }

  if (key === "today") {
    return { start: referenceDate, end: referenceDate };
  }

  if (key === "yesterday") {
    const yesterday = addDays(referenceDate, -1);
    return { start: yesterday, end: yesterday };
  }

  if (key === "this-week") {
    // The running week stops at the reference day; the rest has not happened.
    return { start: startOfWeek(referenceDate), end: referenceDate };
  }

  if (key === "last-week") {
    const start = addDays(startOfWeek(referenceDate), -7);
    return { start, end: addDays(start, 6) };
  }

  if (key === "this-month") {
    return { start: startOfMonth(referenceDate), end: referenceDate };
  }

  if (key === "last-month") {
    const previousMonth = addMonths(startOfMonth(referenceDate), -1);
    return { start: previousMonth, end: endOfMonth(previousMonth) };
  }

  if (/^\d{4}$/.test(key)) {
    const year = Number(key);
    const referenceYear = Number(referenceDate.slice(0, 4));
    if (year > referenceYear) return null;

    return {
      start: `${year}-01-01`,
      // The running year stops at the reference day instead of pretending the
      // rest of the year already happened.
      end: year === referenceYear ? referenceDate : `${year}-12-31`,
    };
  }

  return null;
}

/** Returns the preset key a range matches, or null for a custom range. */
export function matchTimeframe(
  range: DateRange,
  referenceDate: string = PREVIEW_REFERENCE_DATE,
): string | null {
  return (
    TIMEFRAME_PRESETS.find((preset) => {
      const resolved = resolveTimeframe(preset.key, referenceDate);
      return (
        resolved !== null &&
        resolved.start === range.start &&
        resolved.end === range.end
      );
    })?.key ?? null
  );
}

/**
 * Reporting runs on a 30-day cycle, not a calendar month.
 *
 * The chain runs 27 Mar–25 Apr, 26 Apr–25 May,
 * 26 May–24 Jun, 25 Jun–24 Jul, 25 Jul–23 Aug, 24 Aug–22 Sep. Every window is
 * exactly 30 days and each starts the day after the previous one ends, so the
 * whole chain — backwards and forwards — follows from one anchor. A cycle is
 * named after the month it CLOSES in, which is how the team refers
 * to it: the window ending 22 September is the September report.
 *
 * This matters to money. Apportioning an agreed monthly budget over "the days
 * in the calendar month" divides by 28, 30 or 31 depending on which month the
 * filter happens to end in, and none of those is the period the plan was
 * agreed against. The denominator is always 30.
 */
export const REPORTING_CYCLE_DAYS = 30;

/**
 * First day of the April 2026 report, the earliest cycle the team ratified.
 * Cycles before it resolve by stepping backwards; the anchor is a phase, not a
 * lower bound.
 */
export const REPORTING_CYCLE_ANCHOR = "2026-03-27";

export interface ReportingCycle {
  /** Inclusive first day, e.g. `2026-08-24`. */
  start: string;
  /** Inclusive last day, e.g. `2026-09-22`. */
  end: string;
  /** The month the cycle closes in, e.g. `September 2026`. */
  label: string;
  /** Whole 30-day steps from the anchor. Negative before it. */
  index: number;
}

function daysFromAnchor(date: string): number {
  const day = Date.parse(`${date}T00:00:00Z`);
  const anchor = Date.parse(`${REPORTING_CYCLE_ANCHOR}T00:00:00Z`);

  if (!Number.isFinite(day)) {
    throw new Error("A reporting cycle needs a valid YYYY-MM-DD date.");
  }

  return Math.round((day - anchor) / 86_400_000);
}

/** The 30-day reporting cycle a given day falls inside. */
export function resolveReportingCycle(date: string): ReportingCycle {
  const index = Math.floor(daysFromAnchor(date) / REPORTING_CYCLE_DAYS);
  return reportingCycleByIndex(index);
}

export function reportingCycleByIndex(index: number): ReportingCycle {
  const start = addDays(REPORTING_CYCLE_ANCHOR, index * REPORTING_CYCLE_DAYS);
  const end = addDays(start, REPORTING_CYCLE_DAYS - 1);

  return { start, end, label: monthLabel(end), index };
}

/**
 * The cycle a filtered window belongs to — the one its LAST day falls in.
 *
 * The end day decides because that is the cycle the reader is currently
 * spending against. A 90-day filter reaches back across three cycles, and
 * pacing it against the oldest of them would answer a question nobody asked.
 */
export function resolveReportingCycleForRange(range: DateRange): ReportingCycle {
  return resolveReportingCycle(range.end);
}

/**
 * The cycle the reader is actually working in, and the single definition every
 * budget path must use: the cycle the filter's last day falls in, or the live
 * one when the filter reaches past today.
 *
 * Without the clamp a filter ending in the future selects a cycle that has not
 * begun. Pacing would then report day 0 of 30 against a budget the team has
 * not agreed yet, and — worse — the budget loader and the pacing card could
 * resolve two different cycles from the same screen, so the figure being
 * edited would not be the figure being paced.
 */
export function resolvePacingCycle(
  range: DateRange,
  referenceDate: string,
): ReportingCycle {
  return resolveReportingCycle(
    range.end < referenceDate ? range.end : referenceDate,
  );
}
