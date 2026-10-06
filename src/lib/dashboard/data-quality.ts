import type {
  DailyMetric,
  DataQualityIssue,
  DataQualityIssueCode,
  DataQualityReport,
  DataStatus,
  DateRange,
  Platform,
  PlatformCoverage,
  TimezoneAlignment,
} from "@/lib/dashboard/types";

export interface DataQualityOptions {
  /** Wall-clock day used only to decide whether the range touches today. */
  today?: string;
  /** Reporting contract currency for the pilot account. */
  expectedCurrency?: string;
  /** Live mode never publishes a summary until parity is approved. */
  mode?: "mock" | "live";
}

const DAY_IN_MILLISECONDS = 86_400_000;

/**
 * Timezones treated as one GMT/BST market. Google Ads can report such an
 * account as `Etc/GMT` while Meta reports the same market as `Europe/London`.
 * Their days are identical in winter and start one hour apart during British
 * Summer Time. Deliberately narrow: every other mix keeps blocking, and
 * widening this set is a reporting-contract decision, not a code fix.
 */
const UK_GMT_BST_TIMEZONES: ReadonlySet<string> = new Set([
  "Etc/GMT",
  "Etc/UTC",
  "GMT",
  "UTC",
  "Europe/London",
]);

/** BST moves London one hour ahead of GMT. A wider gap is not BST. */
const UK_SUMMER_TIME_TOLERANCE_MINUTES = 60;

/**
 * Warnings that disclose a caveat on data that arrived in full. A sync that
 * raises only these did not lose coverage and must not be reported as
 * "incomplete coverage".
 */
const DISCLOSURE_ONLY_ISSUE_CODES: ReadonlySet<DataQualityIssueCode> = new Set([
  "timezone-mismatch-bst",
]);

export function isDisclosureOnlyIssue(issue: DataQualityIssue): boolean {
  return DISCLOSURE_ONLY_ISSUE_CODES.has(issue.code);
}

const offsetFormatters = new Map<string, Intl.DateTimeFormat>();

/**
 * Offset of `timeZone` from UTC at one instant, in minutes. Null when the
 * runtime cannot resolve the zone, which callers must treat as a mismatch.
 */
export function utcOffsetMinutes(timeZone: string, instant: Date): number | null {
  let formatter = offsetFormatters.get(timeZone);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      return null;
    }
    offsetFormatters.set(timeZone, formatter);
  }

  const parts: Record<string, number> = {};
  for (const part of formatter.formatToParts(instant)) {
    parts[part.type] = Number(part.value);
  }
  const wallClockAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return Math.round((wallClockAsUtc - instant.getTime()) / 60_000);
}

/**
 * Compares the real day boundaries of every account timezone in scope. Each
 * day is sampled at both of its UTC edges, so the DST changeover days are
 * caught whichever edge the clock change falls on.
 */
export function evaluateTimezoneAlignment(
  rows: readonly DailyMetric[],
  dates: readonly string[],
): TimezoneAlignment {
  const platformTimezones = [
    ...new Map(
      rows.map((row) => [
        `${row.platform}|${row.accountTimezone}`,
        { platform: row.platform, timezone: row.accountTimezone },
      ]),
    ).values(),
  ].toSorted((left, right) =>
    left.platform !== right.platform
      ? left.platform < right.platform ? -1 : 1
      : left.timezone < right.timezone ? -1 : left.timezone > right.timezone ? 1 : 0,
  );
  const timezones = [...new Set(rows.map((row) => row.accountTimezone))].toSorted();

  if (timezones.length <= 1) {
    return { status: "single", platformTimezones, maxOffsetMinutes: 0, offsetDates: [] };
  }

  let maxOffsetMinutes = 0;
  const offsetDates: string[] = [];
  for (const date of dates) {
    const dayStart = new Date(`${date}T00:00:00Z`);
    const dayEnd = new Date(dayStart.getTime() + DAY_IN_MILLISECONDS);
    let boundariesDiffer = false;

    for (const instant of [dayStart, dayEnd]) {
      const offsets = timezones.map((timezone) => utcOffsetMinutes(timezone, instant));
      if (offsets.some((offset) => offset === null)) {
        return {
          status: "incompatible",
          platformTimezones,
          maxOffsetMinutes: null,
          offsetDates: [],
        };
      }
      const resolved = offsets as number[];
      const spread = Math.max(...resolved) - Math.min(...resolved);
      maxOffsetMinutes = Math.max(maxOffsetMinutes, spread);
      if (spread > 0) boundariesDiffer = true;
    }

    if (boundariesDiffer) offsetDates.push(date);
  }

  const isUkPair = timezones.every((timezone) => UK_GMT_BST_TIMEZONES.has(timezone));
  const status: TimezoneAlignment["status"] = !isUkPair
    ? "incompatible"
    : maxOffsetMinutes === 0
      ? "equivalent"
      : maxOffsetMinutes <= UK_SUMMER_TIME_TOLERANCE_MINUTES
        ? "uk-summer-time-offset"
        : "incompatible";

  return { status, platformTimezones, maxOffsetMinutes, offsetDates };
}

function describePlatformTimezones(alignment: TimezoneAlignment): string {
  const label = (platform: Exclude<Platform, "all">) =>
    platform === "google" ? "Google Ads" : "Meta Ads";
  return alignment.platformTimezones
    .map((item) => `${label(item.platform)} (${item.timezone})`)
    .join(" and ");
}

export type DataStatusTone = "positive" | "warning" | "negative";

/**
 * Status marks in the utility bar must agree with the state word printed next
 * to them. A ready badge stays green; anything the reader has to act on must
 * not keep the healthy tone.
 */
export function dataStatusTone(status: DataStatus): DataStatusTone {
  switch (status) {
    case "ready":
      return "positive";
    case "partial":
    case "stale":
      return "warning";
    case "blocked":
      return "negative";
  }
}

export function enumerateDates(range: DateRange): string[] {
  const start = new Date(`${range.start}T00:00:00Z`);
  const end = new Date(`${range.end}T00:00:00Z`);

  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    start > end
  ) {
    return [];
  }

  const dates: string[] = [];
  for (
    let cursor = start.getTime();
    cursor <= end.getTime();
    cursor += DAY_IN_MILLISECONDS
  ) {
    dates.push(new Date(cursor).toISOString().slice(0, 10));
  }

  return dates;
}

/**
 * Stable identity of an account-level metric row. It follows the
 * `daily_metrics` conflict target for the account entity and adds the source
 * connector so mock rows can never merge into live rows.
 */
export function metricRowKey(row: DailyMetric): string {
  return [
    row.date,
    row.platform,
    row.accountId,
    row.sourceConnector,
    row.sourceQueryVersion,
  ].join("|");
}

/**
 * Upsert-only merge. Incoming rows replace same-key rows and nothing is
 * removed, so a failed pull on one platform cannot delete another platform's
 * valid data and repeating the same refresh cannot create duplicates.
 */
export function mergeMetricRows(
  existing: readonly DailyMetric[],
  incoming: readonly DailyMetric[],
): DailyMetric[] {
  const merged = new Map<string, DailyMetric>();

  for (const row of existing) {
    merged.set(metricRowKey(row), row);
  }

  for (const row of incoming) {
    merged.set(metricRowKey(row), row);
  }

  return [...merged.values()].toSorted((left, right) => {
    if (left.date !== right.date) return left.date < right.date ? -1 : 1;
    if (left.platform !== right.platform) {
      return left.platform < right.platform ? -1 : 1;
    }
    return metricRowKey(left) < metricRowKey(right) ? -1 : 1;
  });
}

function expectedPlatforms(
  platform: Platform,
): Exclude<Platform, "all">[] {
  return platform === "all" ? ["meta", "google"] : [platform];
}

function toPercent(covered: number, expected: number): number {
  if (expected === 0) return 0;
  return Math.round((covered / expected) * 1000) / 10;
}

function findDuplicateKeys(rows: readonly DailyMetric[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const row of rows) {
    const key = metricRowKey(row);
    if (seen.has(key)) {
      duplicates.add(key);
      continue;
    }
    seen.add(key);
  }

  return [...duplicates].toSorted();
}

/**
 * Deterministic data-quality gate for one dashboard filter. It never reads
 * credentials and never calls a connector; it only judges rows already stored.
 */
export function evaluateDataQuality(
  rows: readonly DailyMetric[],
  range: DateRange,
  platform: Platform = "all",
  options: DataQualityOptions = {},
): DataQualityReport {
  const mode = options.mode ?? "mock";
  const expectedCurrency = options.expectedCurrency;
  const dates = enumerateDates(range);
  const platforms = expectedPlatforms(platform);
  const scopedRows = rows.filter(
    (row) =>
      row.date >= range.start &&
      row.date <= range.end &&
      (platform === "all" || row.platform === platform),
  );
  const issues: DataQualityIssue[] = [];

  const platformCoverage = platforms.map<PlatformCoverage>((item) => {
    const covered = new Set(
      scopedRows.filter((row) => row.platform === item).map((row) => row.date),
    );
    const missingDates = dates.filter((date) => !covered.has(date));

    return {
      platform: item,
      expectedDays: dates.length,
      coveredDays: covered.size,
      coveragePercent: toPercent(covered.size, dates.length),
      missingDates,
      status:
        covered.size === 0
          ? "missing"
          : missingDates.length === 0
            ? "ready"
            : "partial",
    };
  });

  const expectedRowCount = dates.length * platforms.length;
  const coveredRowCount = platformCoverage.reduce(
    (total, item) => total + item.coveredDays,
    0,
  );
  const missingDates = [
    ...new Set(platformCoverage.flatMap((item) => item.missingDates)),
  ].toSorted();

  if (scopedRows.length === 0) {
    issues.push({
      code: "no-data",
      severity: "blocking",
      platform,
      safeMessage:
        "No stored metric row covers this filter. Run a refresh before reading KPIs.",
      dates: [],
    });
  }

  for (const item of platformCoverage) {
    if (item.status === "missing" && scopedRows.length > 0) {
      issues.push({
        code: "platform-missing",
        severity: "blocking",
        platform: item.platform,
        safeMessage: `No ${item.platform} row is stored for this period, so cross-platform totals are incomplete.`,
        dates: [],
      });
      continue;
    }

    if (item.status === "partial") {
      issues.push({
        code: "missing-date",
        severity: "warning",
        platform: item.platform,
        safeMessage: `${item.missingDates.length} day(s) of ${item.platform} data are missing and need a backfill.`,
        dates: item.missingDates,
      });
    }
  }

  const duplicateKeys = findDuplicateKeys(scopedRows);
  if (duplicateKeys.length > 0) {
    issues.push({
      code: "duplicate-row",
      severity: "blocking",
      platform,
      safeMessage:
        "Duplicate metric identities are stored. The upsert contract was bypassed and totals would double count.",
      dates: [
        ...new Set(duplicateKeys.map((key) => key.split("|")[0] ?? "")),
      ].toSorted(),
    });
  }

  // Currency is native per account and never converted, so the guardrail is
  // that a scope reports exactly one currency. When the account contract
  // supplies the expected currency we also catch a wrong-but-consistent
  // mapping; without it we can still catch the dangerous mixed case.
  const presentCurrencies = [
    ...new Set(scopedRows.map((row) => row.currency)),
  ].toSorted();
  const contractCurrency = expectedCurrency ?? presentCurrencies[0];
  const mismatchedCurrencyDates = [
    ...new Set(
      scopedRows
        .filter((row) => row.currency !== contractCurrency)
        .map((row) => row.date),
    ),
  ].toSorted();
  if (mismatchedCurrencyDates.length > 0) {
    issues.push({
      code: "currency-mismatch",
      severity: "blocking",
      platform,
      safeMessage: `Stored rows do not all report ${contractCurrency}. Spend, revenue, and cost-per figures must never be aggregated across currencies.`,
      dates: mismatchedCurrencyDates,
    });
  }

  // Judged on real day boundaries, not zone names. The UK GMT/BST pair is
  // published with a disclaimer; any other mix still blocks, because a
  // cross-platform day with different boundaries is silently wrong.
  const timezoneAlignment = evaluateTimezoneAlignment(scopedRows, dates);
  if (timezoneAlignment.status === "incompatible") {
    issues.push({
      code: "timezone-mismatch",
      severity: "blocking",
      platform,
      safeMessage:
        "Stored rows mix account timezones, so daily boundaries are not comparable.",
      dates: [],
    });
  } else if (timezoneAlignment.status === "uk-summer-time-offset") {
    issues.push({
      code: "timezone-mismatch-bst",
      severity: "warning",
      platform,
      safeMessage: `${describePlatformTimezones(timezoneAlignment)} report on the UK GMT/BST pair. During British Summer Time their days start one hour apart, so on ${timezoneAlignment.offsetDates.length} day(s) in this period each platform's daily figures cover hours shifted by up to ${timezoneAlignment.maxOffsetMinutes} minutes. Read single-day cross-platform comparisons with that in mind.`,
      dates: timezoneAlignment.offsetDates,
    });
  }

  const provisionalDates = [
    ...new Set(scopedRows.filter((row) => row.isProvisional).map((row) => row.date)),
  ].toSorted();
  if (provisionalDates.length > 0) {
    issues.push({
      code: "provisional-day",
      severity: "warning",
      platform,
      safeMessage:
        "Provisional days are included. Platform figures for an open day can still change.",
      dates: provisionalDates,
    });
  }

  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const currentDayIncluded = dates.includes(today);

  const lastSyncedAt =
    scopedRows
      .map((row) => row.syncedAt)
      .filter(Boolean)
      .toSorted()
      .at(-1) ?? null;
  const isStale =
    scopedRows.length > 0 &&
    (lastSyncedAt === null || lastSyncedAt.slice(0, 10) < range.end);

  if (isStale) {
    issues.push({
      code: "stale-sync",
      severity: "warning",
      platform,
      safeMessage:
        "The stored snapshot is older than the last day in this period. Refresh before reporting.",
      dates: [],
    });
  }

  const hasBlockingIssue = issues.some(
    (issue) => issue.severity === "blocking",
  );
  const hasMissingDate = missingDates.length > 0;

  const status: DataStatus = hasBlockingIssue
    ? "blocked"
    : hasMissingDate
      ? "partial"
      : isStale
        ? "stale"
        : "ready";

  return {
    expectedDays: dates.length,
    expectedRowCount,
    coveragePercent: toPercent(coveredRowCount, expectedRowCount),
    platformCoverage,
    missingDates,
    duplicateKeys,
    provisionalDates,
    currentDayIncluded,
    lastSyncedAt,
    status,
    summaryBlocked: status === "blocked" || status === "partial" || mode === "live",
    issues,
    timezoneAlignment,
  };
}
