import type { Currency, DateRange } from "@/lib/dashboard/types";
import type {
  ChannelPerformanceRow,
  FunnelStep,
  ReferringChannel,
  ShareRow,
  StoreAnalyticsSnapshot,
  StoreKpi,
  TimeSeries,
} from "@/lib/store/types";

export type Ga4StoreBreakdown =
  | "total"
  | "channel"
  | "device"
  | "landing_page"
  | "country"
  | "city";

/**
 * Read model shared by the GA4 API row and `ga4_daily_metrics`.
 *
 * `currency` is optional for backward compatibility with readers deployed
 * before the column was selected. Its absence is surfaced as unverified; it is
 * never treated as a match.
 */
export interface Ga4DailyRow {
  date: string;
  breakdown: Ga4StoreBreakdown;
  breakdownValue: string;
  sessions: number;
  activeUsers: number;
  bounceRate: number;
  averageSessionDurationSeconds: number;
  addToCarts: number;
  checkouts: number;
  ecommercePurchases: number;
  grossPurchaseRevenue: number;
  currency?: string;
  isProvisional: boolean;
}

export type Ga4BridgeCurrencyStatus =
  | "matched"
  | "mismatch"
  | "mixed"
  | "unverified";

export type Ga4BridgeStatus =
  | "ready"
  | "provisional"
  | "blocked";

export type Ga4FunnelStatus = "applied" | "blocked_non_monotonic";

export interface Ga4StoreBridgeQuality {
  status: Ga4BridgeStatus;
  expectedDays: number;
  coveredDays: number;
  missingDays: string[];
  duplicateTotalDays: string[];
  provisionalDays: string[];
  invalidRowIndexes: number[];
  currencyStatus: Ga4BridgeCurrencyStatus;
  expectedCurrency: Currency;
  reportedCurrencies: string[];
  /** GA4 money never overwrites store money unless a later contract opts in. */
  monetaryFieldsApplied: false;
  anomalyEvaluation: "enabled" | "suppressed";
  funnelStatus: Ga4FunnelStatus;
}

export interface Ga4StoreBridgeResult {
  applied: boolean;
  snapshot: StoreAnalyticsSnapshot;
  quality: Ga4StoreBridgeQuality;
  warnings: string[];
}

/**
 * Formal source-to-target map. GA4 is daily aggregate data, so `StoreSession`
 * is a semantic target only: the bridge updates aggregate session projections
 * and never invents row-level session ids.
 */
export const GA4_TO_STORE_MAPPING = {
  sessions: {
    source: "sessions",
    semanticTarget: "StoreSession",
    snapshotTargets: ["kpis.sessions", "sessionsOverTime", "conversionFunnel.sessions"],
    materialization: "aggregate-only",
  },
  addToCarts: {
    source: "addToCarts",
    snapshotTarget: "conversionFunnel.addToCart",
  },
  checkouts: {
    source: "checkouts",
    snapshotTarget: "conversionFunnel.checkout",
  },
  ecommercePurchases: {
    source: "ecommercePurchases",
    snapshotTarget: "conversionFunnel.placedOrders",
  },
  channelGrouping: {
    source: "breakdown=channel",
    snapshotTarget: "performanceByReferringChannel",
    vocabulary: ["Direct", "Paid", "Organic", "Social", "Unknown"],
  },
} as const;

const BREAKDOWNS = new Set<Ga4StoreBreakdown>([
  "total",
  "channel",
  "device",
  "landing_page",
  "country",
  "city",
]);

const NON_NEGATIVE_FIELDS = [
  "sessions",
  "activeUsers",
  "averageSessionDurationSeconds",
  "addToCarts",
  "checkouts",
  "ecommercePurchases",
  "grossPurchaseRevenue",
] as const satisfies readonly (keyof Ga4DailyRow)[];

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

export function isGa4DailyRow(value: unknown): value is Ga4DailyRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<Ga4DailyRow>;
  if (
    typeof row.date !== "string" ||
    !isIsoDate(row.date) ||
    typeof row.breakdown !== "string" ||
    !BREAKDOWNS.has(row.breakdown as Ga4StoreBreakdown) ||
    typeof row.breakdownValue !== "string" ||
    row.breakdownValue.trim().length === 0 ||
    typeof row.isProvisional !== "boolean" ||
    typeof row.bounceRate !== "number" ||
    !Number.isFinite(row.bounceRate) ||
    row.bounceRate < 0 ||
    row.bounceRate > 1
  ) {
    return false;
  }

  return NON_NEGATIVE_FIELDS.every((field) => {
    const number = row[field];
    return typeof number === "number" && Number.isFinite(number) && number >= 0;
  });
}

function enumerateDays(range: DateRange): string[] {
  if (!isIsoDate(range.start) || !isIsoDate(range.end) || range.start > range.end) {
    return [];
  }
  const days: string[] = [];
  const end = Date.parse(`${range.end}T00:00:00Z`);
  for (
    let cursor = Date.parse(`${range.start}T00:00:00Z`);
    cursor <= end;
    cursor += 86_400_000
  ) {
    days.push(new Date(cursor).toISOString().slice(0, 10));
  }
  return days;
}

function sum(
  rows: readonly Ga4DailyRow[],
  pick: (row: Ga4DailyRow) => number,
): number {
  return rows.reduce((total, row) => total + pick(row), 0);
}

export function mapGa4ChannelGrouping(value: string): ReferringChannel {
  const normalized = value.trim().toLowerCase().replace(/[_-]+/g, " ");
  if (!normalized || normalized === "(not set)" || normalized === "unknown") {
    return "Unknown";
  }
  if (normalized === "direct" || normalized === "(direct)") return "Direct";
  if (normalized.includes("organic") && normalized.includes("social")) return "Social";
  if (normalized.includes("social")) {
    return normalized.includes("paid") ? "Paid" : "Social";
  }
  if (
    normalized.includes("paid") ||
    normalized.includes("display") ||
    normalized.includes("cross network") ||
    normalized.includes("affiliate") ||
    normalized.includes("audio")
  ) {
    return "Paid";
  }
  if (normalized.includes("organic")) return "Organic";
  if (["direct", "paid", "organic", "social"].includes(normalized)) {
    return `${normalized[0].toUpperCase()}${normalized.slice(1)}` as ReferringChannel;
  }
  return "Unknown";
}

function currencyQuality(
  rows: readonly Ga4DailyRow[],
  expectedCurrency: Currency,
): Pick<
  Ga4StoreBridgeQuality,
  "currencyStatus" | "expectedCurrency" | "reportedCurrencies"
> {
  const reportedCurrencies = [
    ...new Set(
      rows
        .map((row) => row.currency?.trim().toUpperCase())
        .filter((currency): currency is string => Boolean(currency)),
    ),
  ].toSorted();

  const currencyStatus: Ga4BridgeCurrencyStatus =
    reportedCurrencies.length === 0
      ? "unverified"
      : reportedCurrencies.length > 1
        ? "mixed"
        : reportedCurrencies[0] === expectedCurrency
          ? "matched"
          : "mismatch";

  return { currencyStatus, expectedCurrency, reportedCurrencies };
}

function shareRows(
  rows: readonly Ga4DailyRow[],
  breakdown: Ga4StoreBreakdown,
  previous: readonly ShareRow[],
): ShareRow[] {
  const grouped = new Map<string, number>();
  for (const row of rows.filter((item) => item.breakdown === breakdown)) {
    const label = row.breakdownValue.trim() || "(not set)";
    grouped.set(label, (grouped.get(label) ?? 0) + row.sessions);
  }
  const total = [...grouped.values()].reduce((current, value) => current + value, 0);

  return [...grouped.entries()]
    .map(([label, value]) => ({
      key: label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "unknown",
      label,
      value,
      previousValue: previous.find((row) => row.label === label)?.previousValue ?? null,
      share: total === 0 ? 0 : value / total,
    }))
    .toSorted((left, right) => right.value - left.value || left.label.localeCompare(right.label));
}

function buildFunnel(
  totals: readonly Ga4DailyRow[],
  previous: readonly FunnelStep[],
): { steps: FunnelStep[]; status: Ga4FunnelStatus } {
  const counts = [
    sum(totals, (row) => row.sessions),
    sum(totals, (row) => row.addToCarts),
    sum(totals, (row) => row.checkouts),
    sum(totals, (row) => row.ecommercePurchases),
  ];
  const monotonic = counts.every((value, index) => index === 0 || value <= counts[index - 1]);
  if (!monotonic) {
    return { steps: [...previous], status: "blocked_non_monotonic" };
  }

  const definitions = [
    { key: "sessions", label: "Sessions" },
    { key: "addToCart", label: "Added to cart" },
    { key: "checkout", label: "Reached checkout" },
    { key: "purchase", label: "Placed orders" },
  ];

  return {
    status: "applied",
    steps: definitions.map((definition, index) => ({
      ...definition,
      sessions: counts[index],
      previousSessions: null,
      rateFromEntry: counts[0] === 0 ? 0 : counts[index] / counts[0],
      rateFromPreviousStep:
        index === 0 || counts[index - 1] === 0
          ? null
          : counts[index] / counts[index - 1],
      // Money remains owned by the store source, never by this bridge.
      salesValue:
        previous.find((step) => step.key === definition.key)?.salesValue ?? null,
    })),
  };
}

function hydrateKpis(kpis: readonly StoreKpi[], totals: readonly Ga4DailyRow[]): StoreKpi[] {
  const sessions = sum(totals, (row) => row.sessions);
  const purchases = sum(totals, (row) => row.ecommercePurchases);
  return kpis.map((kpi) => {
    if (kpi.key === "sessions") return { ...kpi, value: sessions, previousValue: null };
    if (kpi.key === "conversionRate") {
      return {
        ...kpi,
        value: sessions === 0 ? null : purchases / sessions,
        previousValue: null,
      };
    }
    return kpi;
  });
}

function dailySeries(
  totals: readonly Ga4DailyRow[],
  template: TimeSeries,
  pick: (row: Ga4DailyRow) => number,
  aggregate?: (rows: readonly Ga4DailyRow[]) => number | null,
): TimeSeries {
  const points = totals
    .map((row) => ({ date: row.date, value: pick(row), comparisonValue: null }))
    .toSorted((left, right) => left.date.localeCompare(right.date));
  return {
    ...template,
    points,
    total: aggregate
      ? aggregate(totals)
      : points.reduce((total, point) => total + point.value, 0),
    previousTotal: null,
  };
}

function hydrateChannels(
  existing: readonly ChannelPerformanceRow[],
  rows: readonly Ga4DailyRow[],
): ChannelPerformanceRow[] {
  const grouped = new Map<ReferringChannel, number>();
  for (const row of rows.filter((item) => item.breakdown === "channel")) {
    const channel = mapGa4ChannelGrouping(row.breakdownValue);
    grouped.set(channel, (grouped.get(channel) ?? 0) + row.sessions);
  }
  if (grouped.size === 0) return [...existing];

  const hydrated = existing.map((row) => {
    const sessions = grouped.get(row.channel);
    if (sessions === undefined) return row;
    return {
      ...row,
      sessions,
      conversionRate: sessions === 0 ? null : row.orders / sessions,
    };
  });

  for (const [channel, sessions] of grouped) {
    if (hydrated.some((row) => row.channel === channel)) continue;
    hydrated.push({
      channel,
      sessions,
      orders: 0,
      totalSales: 0,
      conversionRate: sessions === 0 ? null : 0,
      averageOrderValue: null,
    });
  }

  return hydrated.toSorted(
    (left, right) => right.sessions - left.sessions || left.channel.localeCompare(right.channel),
  );
}

function blockedResult(
  snapshot: StoreAnalyticsSnapshot,
  quality: Ga4StoreBridgeQuality,
  warnings: string[],
): Ga4StoreBridgeResult {
  return { applied: false, snapshot, quality, warnings };
}

/**
 * Applies the real GA4 aggregate to traffic-only Store Analytics projections.
 *
 * Mathematical guardrails:
 * - every selected day needs exactly one total row;
 * - a provisional row may exist only on the range end and suppresses anomaly
 *   evaluation;
 * - a non-monotonic GA4 funnel is withheld rather than clamped;
 * - currency mismatch never blocks dimensionless counts, but GA4 money never
 *   overwrites store money.
 */
export function applyGa4StoreBridge(
  snapshot: StoreAnalyticsSnapshot,
  inputRows: readonly Ga4DailyRow[],
): Ga4StoreBridgeResult {
  const expectedDays = enumerateDays(snapshot.selectedRange);
  const scopedRows = inputRows.filter(
    (row) => row.date >= snapshot.selectedRange.start && row.date <= snapshot.selectedRange.end,
  );
  const invalidRowIndexes = scopedRows
    .map((row, index) => (isGa4DailyRow(row) ? -1 : index))
    .filter((index) => index >= 0);
  const validRows = invalidRowIndexes.length === 0 ? scopedRows : [];
  const totals = validRows.filter((row) => row.breakdown === "total");
  const totalsPerDay = new Map<string, number>();
  for (const row of totals) {
    totalsPerDay.set(row.date, (totalsPerDay.get(row.date) ?? 0) + 1);
  }
  const coveredDays = [...totalsPerDay.keys()].filter((date) => expectedDays.includes(date));
  const missingDays = expectedDays.filter((date) => !totalsPerDay.has(date));
  const duplicateTotalDays = [...totalsPerDay.entries()]
    .filter(([, count]) => count > 1)
    .map(([date]) => date)
    .toSorted();
  const provisionalDays = [
    ...new Set(validRows.filter((row) => row.isProvisional).map((row) => row.date)),
  ].toSorted();
  const currency = currencyQuality(validRows, snapshot.store.currency);
  const invalidProvisionalDays = provisionalDays.filter(
    (date) => date !== snapshot.selectedRange.end,
  );
  const blocked =
    expectedDays.length === 0 ||
    invalidRowIndexes.length > 0 ||
    missingDays.length > 0 ||
    duplicateTotalDays.length > 0 ||
    invalidProvisionalDays.length > 0;

  const warnings: string[] = [];
  if (expectedDays.length === 0) warnings.push("The selected date range is invalid.");
  if (invalidRowIndexes.length > 0) {
    warnings.push(`GA4 contains ${invalidRowIndexes.length} invalid row(s).`);
  }
  if (missingDays.length > 0) {
    warnings.push(
      `GA4 is missing ${missingDays.length} selected day(s): ${missingDays.join(", ")}.`,
    );
  }
  if (duplicateTotalDays.length > 0) {
    warnings.push(`GA4 has duplicate total rows for: ${duplicateTotalDays.join(", ")}.`);
  }
  if (invalidProvisionalDays.length > 0) {
    warnings.push(
      `Only the range end may be provisional; invalid day(s): ${invalidProvisionalDays.join(", ")}.`,
    );
  }
  if (currency.currencyStatus === "unverified") {
    warnings.push("GA4 currency is unverified; monetary fields remain owned by the store source.");
  } else if (currency.currencyStatus !== "matched") {
    warnings.push(
      `GA4 currency is ${currency.currencyStatus}; monetary fields remain owned by the store source.`,
    );
  }

  const baseQuality: Ga4StoreBridgeQuality = {
    status: blocked ? "blocked" : provisionalDays.length > 0 ? "provisional" : "ready",
    expectedDays: expectedDays.length,
    coveredDays: coveredDays.length,
    missingDays,
    duplicateTotalDays,
    provisionalDays,
    invalidRowIndexes,
    ...currency,
    monetaryFieldsApplied: false,
    anomalyEvaluation: blocked || provisionalDays.length > 0 ? "suppressed" : "enabled",
    funnelStatus: "applied",
  };

  if (blocked) return blockedResult(snapshot, baseQuality, warnings);

  const funnel = buildFunnel(totals, snapshot.conversionFunnel);
  if (funnel.status === "blocked_non_monotonic") {
    warnings.push(
      "GA4 funnel counts are non-monotonic, so the previous funnel is retained rather than clamped.",
    );
  }

  const deviceShares = shareRows(validRows, "device", snapshot.sessionsByDevice);
  const landingPageShares = shareRows(
    validRows,
    "landing_page",
    snapshot.sessionsByLandingPage,
  );
  const locationShares = shareRows(validRows, "country", snapshot.sessionsByLocation);

  const nextSnapshot: StoreAnalyticsSnapshot = {
    ...snapshot,
    kpis: hydrateKpis(snapshot.kpis, totals),
    sessionsOverTime: dailySeries(totals, snapshot.sessionsOverTime, (row) => row.sessions),
    conversionRateOverTime: dailySeries(
      totals,
      snapshot.conversionRateOverTime,
      (row) => (row.sessions === 0 ? 0 : row.ecommercePurchases / row.sessions),
      (rows) => {
        const sessions = sum(rows, (row) => row.sessions);
        return sessions === 0
          ? null
          : sum(rows, (row) => row.ecommercePurchases) / sessions;
      },
    ),
    conversionFunnel: funnel.steps,
    performanceByReferringChannel: hydrateChannels(
      snapshot.performanceByReferringChannel,
      validRows,
    ),
    sessionsByDevice:
      deviceShares.length > 0 ? deviceShares : snapshot.sessionsByDevice,
    sessionsByLandingPage:
      landingPageShares.length > 0
        ? landingPageShares
        : snapshot.sessionsByLandingPage,
    sessionsByLocation:
      locationShares.length > 0 ? locationShares : snapshot.sessionsByLocation,
  };

  return {
    applied: true,
    snapshot: nextSnapshot,
    quality: { ...baseQuality, funnelStatus: funnel.status },
    warnings,
  };
}
