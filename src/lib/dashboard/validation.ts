import type {
  DashboardDataMode,
  DashboardStorageMode,
  DateRange,
  Platform,
} from "@/lib/dashboard/types";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** The longest range the dashboard will query. The picker enforces the same ceiling
 *  so a reader is told before the request instead of after it fails. */
export const MAX_RANGE_DAYS = 1826;

export interface DashboardDataEnvironment {
  DASHBOARD_DATA_MODE?: string;
  DASHBOARD_DATA_STORE?: string;
}

/**
 * Where the reader's chosen ingestion mode is remembered between visits.
 *
 * A first-party cookie rather than localStorage, for the same reason the brand
 * selector uses one: the server has to resolve the mode *before* it renders.
 * A preference the server cannot see forces the client to correct the page
 * after mount, which is both a hydration mismatch and a window in which the
 * badge and the data on screen disagree. It holds one of two public words.
 */
export const DATA_MODE_COOKIE = "sl_data_mode";

/**
 * A caller-supplied ingestion mode, before it is trusted.
 *
 * Only the two contract values survive. Anything else — a typo, a stale
 * bookmark, a hand-edited cookie, a probe — is dropped rather than guessed at,
 * which leaves the deployment's own `DASHBOARD_DATA_MODE` in charge. Guessing
 * is what would let `?mode=liv` read as live.
 */
export function parseDataMode(value: unknown): DashboardDataMode | null {
  return value === "mock" || value === "live" ? value : null;
}

export interface DashboardDataConfiguration {
  mode: DashboardDataMode;
  storage: DashboardStorageMode;
}

export function getDashboardDataConfiguration(
  environment: DashboardDataEnvironment =
    process.env as DashboardDataEnvironment,
  modeOverride?: string | null,
): DashboardDataConfiguration {
  const envMode = environment.DASHBOARD_DATA_MODE === "live" ? "live" : "mock";
  const mode =
    modeOverride === "mock" ? "mock" : modeOverride === "live" ? "live" : envMode;
  const envStorage =
    environment.DASHBOARD_DATA_STORE === "supabase" ? "supabase" : "fixture";
  const storage = mode === "mock" ? "fixture" : envStorage;

  return {
    mode,
    storage,
  };
}

export function parsePlatform(value: string | null): Platform {
  return value === "meta" || value === "google" ? value : "all";
}

export function validateDateRange(
  start: unknown,
  end: unknown,
): { ok: true; value: DateRange } | { ok: false; message: string } {
  if (
    typeof start !== "string" ||
    typeof end !== "string" ||
    !DATE_PATTERN.test(start) ||
    !DATE_PATTERN.test(end)
  ) {
    return {
      ok: false,
      message: "Use inclusive start and end dates in YYYY-MM-DD format.",
    };
  }

  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);

  if (
    Number.isNaN(startDate.getTime()) ||
    Number.isNaN(endDate.getTime()) ||
    start > end
  ) {
    return { ok: false, message: "Start date must be on or before end date." };
  }

  const inclusiveDays =
    Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1;

  if (inclusiveDays > MAX_RANGE_DAYS) {
    return {
      ok: false,
      message: `The MVP accepts a maximum range of ${MAX_RANGE_DAYS} days.`,
    };
  }

  return { ok: true, value: { start, end } };
}
