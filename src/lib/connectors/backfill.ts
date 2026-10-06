import { addDays } from "@/lib/dashboard/calendar";
import { currentDateInTimeZone } from "@/lib/dashboard/timeframes";
import type { DateRange } from "@/lib/dashboard/types";

/**
 * Manual backfill windows.
 *
 * A fixed allowlist rather than a free-form day count. An operator repairing a
 * gap wants one of three shapes, and an arbitrary lookback is how someone
 * accidentally asks a platform for two years of data and gets the connector
 * rate-limited for everyone else.
 */
export const BACKFILL_LOOKBACKS = {
  "7d": 7,
  "30d": 30,
  // The reporting floor. Every period comparison the dashboard offers needs a
  // baseline of equal length, so a 30-day view already reads 60 days of
  // history; anything shorter leaves the comparison column empty and the
  // year-on-year panels reading from nothing.
  "60d": 60,
  "90d": 90,
} as const;

/**
 * Year to date: 1 January of the window's own year through yesterday.
 *
 * Kept out of `BACKFILL_LOOKBACKS` because that map means "name to a fixed day
 * count", and this window has no fixed length — it is a week in early January
 * and a full year on 31 December. It is still a *named* window, which is the
 * point of the allowlist: an operator can ask for the year so far, but not for
 * two years by typo.
 *
 * It is the longest window on offer. Late in the year it pulls several times
 * what `90d` does, across every grain Google returns (campaign, search term,
 * device, impression share), which is why the ingestion script walks brands one
 * at a time rather than in parallel.
 */
export const YTD_LOOKBACK = "ytd" as const;

export type BackfillLookback =
  | keyof typeof BACKFILL_LOOKBACKS
  | typeof YTD_LOOKBACK;

/** Every accepted lookback, for validation messages and operator-facing copy. */
export const BACKFILL_LOOKBACK_OPTIONS: readonly BackfillLookback[] = [
  ...(Object.keys(BACKFILL_LOOKBACKS) as (keyof typeof BACKFILL_LOOKBACKS)[]),
  YTD_LOOKBACK,
];

export function isBackfillLookback(value: unknown): value is BackfillLookback {
  return (
    typeof value === "string" &&
    (value in BACKFILL_LOOKBACKS || value === YTD_LOOKBACK)
  );
}

/**
 * Window for a backfill, in the account's own timezone.
 *
 * Ends yesterday for the same reason the scheduled window does: a day still
 * open on the platform would be stored as provisional and make the whole
 * backfill look partial. Re-running any window is safe — every destination
 * table upserts on a stable key, so a repeat corrects days instead of adding
 * them.
 */
export function resolveBackfillWindow(
  lookback: BackfillLookback,
  timeZone: string,
  now: Date = new Date(),
): DateRange {
  const end = addDays(currentDateInTimeZone(timeZone, now), -1);

  if (lookback === YTD_LOOKBACK) {
    // The year comes from `end`, never from today. On 1 January "yesterday" is
    // still 31 December, and anchoring to today would produce a range starting
    // after it ends. Anchoring to `end` returns the outgoing year in full,
    // which is what an operator repairing the year that just closed is asking
    // for; on every other day of the year the two agree.
    return { start: `${end.slice(0, 4)}-01-01`, end };
  }

  return { start: addDays(end, -(BACKFILL_LOOKBACKS[lookback] - 1)), end };
}
