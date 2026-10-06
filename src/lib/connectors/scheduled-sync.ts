import crypto from "crypto";

import { addDays } from "@/lib/dashboard/calendar";
import { currentDateInTimeZone } from "@/lib/dashboard/timeframes";
import type { DateRange } from "@/lib/dashboard/types";

/**
 * Days re-pulled on every scheduled run.
 *
 * A platform keeps restating recent days as late conversions are attributed, so
 * a one-day window would freeze yesterday's numbers at their least accurate
 * value. Re-pulling a trailing week is cheap and safe: `daily_metrics` is
 * upsert-only on a stable conflict target, so a repeat pull corrects a day
 * instead of duplicating it.
 */
export const SCHEDULED_SYNC_LOOKBACK_DAYS = 7;

/**
 * Rolling auction snapshot kept warm for the dashboard's default 14D preset.
 * Unlike daily KPI facts, this period answer ends on the current account-local
 * day because that is the exact range the picker requests. Google aggregates
 * the whole period server-side; the open day is never written as a daily fact
 * by this window.
 */
export const SCHEDULED_IMPRESSION_SHARE_LOOKBACK_DAYS = 14;

/**
 * Window for an operator-triggered refresh.
 *
 * The operator chooses where the analysis starts; the server decides where it
 * ends. That distinction prevents a tab left open overnight (or a saved custom
 * range) from repeatedly syncing only to yesterday. The open account-local day
 * is included deliberately and connectors mark it provisional.
 */
export function resolveManualSyncWindow(
  requestedRange: DateRange,
  timeZone: string,
  now: Date = new Date(),
): DateRange {
  const today = currentDateInTimeZone(timeZone, now);

  if (requestedRange.start > today) {
    throw new Error("Manual sync cannot start after today in the account timezone.");
  }

  return { start: requestedRange.start, end: today };
}

/**
 * Window for a scheduled refresh, in the reporting account's own timezone.
 *
 * It ends yesterday, never today: a day that is still open would be stored as
 * provisional and would make every scheduled snapshot look partial.
 */
export function resolveScheduledSyncWindow(
  timeZone: string,
  now: Date = new Date(),
  lookbackDays: number = SCHEDULED_SYNC_LOOKBACK_DAYS,
): DateRange {
  if (!Number.isInteger(lookbackDays) || lookbackDays < 1) {
    throw new Error("Scheduled sync lookback must be a whole number of days.");
  }

  const end = addDays(currentDateInTimeZone(timeZone, now), -1);
  return { start: addDays(end, -(lookbackDays - 1)), end };
}

export function resolveScheduledImpressionShareWindow(
  timeZone: string,
  now: Date = new Date(),
  lookbackDays: number = SCHEDULED_IMPRESSION_SHARE_LOOKBACK_DAYS,
): DateRange {
  if (!Number.isInteger(lookbackDays) || lookbackDays < 1) {
    throw new Error(
      "Scheduled impression-share lookback must be a whole number of days.",
    );
  }

  const end = currentDateInTimeZone(timeZone, now);
  return { start: addDays(end, -(lookbackDays - 1)), end };
}

/**
 * Authorises a scheduled invocation.
 *
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. With no secret
 * configured this returns false, so an unprotected deployment exposes no
 * refresh trigger at all rather than an open one.
 */
export function isAuthorizedScheduledRequest(
  authorizationHeader: string | null,
  secret: string | undefined = process.env.CRON_SECRET,
): boolean {
  const expected = secret?.trim();
  if (!expected) return false;

  const presented = authorizationHeader?.trim();
  if (!presented?.startsWith("Bearer ")) return false;

  const presentedSecret = Buffer.from(presented.slice("Bearer ".length), "utf8");
  const expectedSecret = Buffer.from(expected, "utf8");
  return (
    presentedSecret.length === expectedSecret.length &&
    crypto.timingSafeEqual(presentedSecret, expectedSecret)
  );
}
