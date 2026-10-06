import type { Currency, DateRange } from "@/lib/dashboard/types";
import type { DeviceKey } from "@/lib/dashboard/device";

export type TrafficLightTone = "green" | "amber" | "red" | "neutral";
export type TrafficLightLevel = "healthy" | "watch" | "critical" | "no_data";
export type AnalyticsSourceStatus = "live" | "provisional" | "masked" | "unavailable";
export type AuctionAggregationBasis = "period_exact" | "daily_derived" | "unavailable";

export interface TrafficLightStatus {
  tone: TrafficLightTone;
  level: TrafficLightLevel;
  /** Required because color must never be the only status carrier. */
  label: string;
}

export interface AuctionLossMetric {
  key: "lost_to_rank" | "lost_to_budget";
  label: string;
  /** Canonical ratio, 0..1. Never pass a human-formatted percent here. */
  ratio: number | null;
  percent: number | null;
  /** Exact values have no prefix; derived period estimates render with `~`. */
  displayValue: string;
  isExact: boolean;
  status: TrafficLightStatus;
}

export interface AuctionDiagnostics {
  platform: "google";
  range: DateRange;
  sourceStatus: AnalyticsSourceStatus;
  aggregationBasis: AuctionAggregationBasis;
  lostToRank: AuctionLossMetric;
  lostToBudget: AuctionLossMetric;
  /** Remainder after the two mutually exclusive loss buckets. */
  capturedShareRatio: number | null;
  dominantConstraint: "rank" | "budget" | "mixed" | "unavailable";
  reconciliation: "valid" | "inconsistent" | "unavailable";
  message: string;
}

export interface AuctionDiagnosticsInput {
  range: DateRange;
  lostToRankRatio: number | null;
  lostToBudgetRatio: number | null;
  sourceStatus?: AnalyticsSourceStatus;
  /** Daily weighted shares can diverge materially from Google's period query. */
  aggregationBasis?: AuctionAggregationBasis;
}

export type DevicePerformanceKey = DeviceKey;

export interface DevicePerformanceInputRow {
  device: DevicePerformanceKey;
  spend: number;
  impressions: number;
  clicks: number;
  registrations: number | null;
  purchases: number | null;
  purchaseValue: number | null;
}

export interface DevicePerformanceAnomaly {
  code: "spend_without_clicks";
  device: DevicePerformanceKey;
  severity: "warning";
  message: string;
}

export interface DevicePerformanceRow extends DevicePerformanceInputRow {
  label: string;
  ctrRatio: number | null;
  cpc: number | null;
  conversionRate: number | null;
  spendShareRatio: number;
  status: TrafficLightStatus;
  anomalies: DevicePerformanceAnomaly[];
}

export interface DevicePerformanceBreakdown {
  platform: "google";
  range: DateRange;
  currency: Currency;
  sourceStatus: AnalyticsSourceStatus;
  rows: DevicePerformanceRow[];
  totals: {
    spend: number;
    impressions: number;
    clicks: number;
    registrations: number | null;
    purchases: number | null;
    purchaseValue: number | null;
  };
  anomalies: DevicePerformanceAnomaly[];
}

export interface DevicePerformanceBreakdownInput {
  range: DateRange;
  currency: Currency;
  sourceStatus?: AnalyticsSourceStatus;
  rows: readonly DevicePerformanceInputRow[];
}

const DEVICE_ORDER: readonly DevicePerformanceKey[] = [
  "mobile",
  "desktop",
  "tablet",
  "connectedTv",
];

const DEVICE_LABELS: Record<DevicePerformanceKey, string> = {
  mobile: "Mobile",
  desktop: "Desktop",
  tablet: "Tablet",
  connectedTv: "Connected TV",
};

export const AUCTION_LOSS_THRESHOLDS = {
  healthyMaximumRatio: 0.1,
  watchMaximumRatio: 0.3,
} as const;

function round(value: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function assertRatio(value: number | null, field: string): void {
  if (value === null) return;
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${field} must be null or a ratio between 0 and 1.`);
  }
}

function assertMetric(value: number | null, field: string): void {
  if (value === null) return;
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${field} must be null or a non-negative finite number.`);
  }
}

function lossStatus(ratio: number | null): TrafficLightStatus {
  if (ratio === null) return { tone: "neutral", level: "no_data", label: "Unavailable" };
  if (ratio <= AUCTION_LOSS_THRESHOLDS.healthyMaximumRatio) {
    return { tone: "green", level: "healthy", label: "Low loss" };
  }
  if (ratio <= AUCTION_LOSS_THRESHOLDS.watchMaximumRatio) {
    return { tone: "amber", level: "watch", label: "Watch" };
  }
  return { tone: "red", level: "critical", label: "High loss" };
}

function auctionMetric(
  key: AuctionLossMetric["key"],
  label: string,
  ratio: number | null,
  aggregationBasis: AuctionAggregationBasis,
): AuctionLossMetric {
  const percent = ratio === null ? null : round(ratio * 100, 1);
  const isExact = ratio !== null && aggregationBasis === "period_exact";
  return {
    key,
    label,
    ratio,
    percent,
    displayValue: percent === null ? "Unavailable" : `${isExact ? "" : "~"}${percent}%`,
    isExact,
    status: lossStatus(ratio),
  };
}

export function buildAuctionDiagnostics(input: AuctionDiagnosticsInput): AuctionDiagnostics {
  assertRatio(input.lostToRankRatio, "lostToRankRatio");
  assertRatio(input.lostToBudgetRatio, "lostToBudgetRatio");
  const rank = input.lostToRankRatio;
  const budget = input.lostToBudgetRatio;
  const aggregationBasis = input.aggregationBasis
    ?? (rank === null || budget === null ? "unavailable" : "period_exact");
  const available = rank !== null && budget !== null;
  const totalLoss = available ? rank + budget : null;
  const reconciliation = totalLoss === null
    ? "unavailable"
    : totalLoss <= 1.005
      ? "valid"
      : "inconsistent";
  const capturedShareRatio = reconciliation === "valid" && totalLoss !== null
    ? round(Math.max(0, 1 - totalLoss))
    : null;
  const dominantConstraint = !available
    ? "unavailable"
    : Math.abs(rank - budget) <= 0.05
      ? "mixed"
      : rank > budget
        ? "rank"
        : "budget";
  const message = reconciliation === "inconsistent"
    ? "Auction loss ratios exceed 100%; withhold the diagnostic until the source grain is reconciled."
    : aggregationBasis === "daily_derived"
      ? "Derived from daily rows; show these values as estimates until a period-level Google Ads query is available."
    : dominantConstraint === "rank"
      ? "Rank is the binding constraint; more budget alone will not recover most lost auctions."
      : dominantConstraint === "budget"
        ? "Budget is the binding constraint; review incremental demand before raising the cap."
        : dominantConstraint === "mixed"
          ? "Rank and budget contribute similar losses; both levers need review."
          : "Auction loss data is unavailable.";

  return {
    platform: "google",
    range: input.range,
    sourceStatus: input.sourceStatus
      ?? (aggregationBasis === "daily_derived"
        ? "provisional"
        : aggregationBasis === "unavailable"
          ? "unavailable"
          : "live"),
    aggregationBasis,
    lostToRank: auctionMetric("lost_to_rank", "Lost to rank", rank, aggregationBasis),
    lostToBudget: auctionMetric("lost_to_budget", "Lost to budget", budget, aggregationBasis),
    capturedShareRatio,
    dominantConstraint,
    reconciliation,
    message,
  };
}

function addNullable(left: number | null, right: number | null): number | null {
  return left === null || right === null ? null : left + right;
}

export function buildDevicePerformanceBreakdown(
  input: DevicePerformanceBreakdownInput,
): DevicePerformanceBreakdown {
  const grouped = new Map<DevicePerformanceKey, DevicePerformanceInputRow>();

  for (const row of input.rows) {
    assertMetric(row.spend, "spend");
    assertMetric(row.impressions, "impressions");
    assertMetric(row.clicks, "clicks");
    assertMetric(row.registrations, "registrations");
    assertMetric(row.purchases, "purchases");
    assertMetric(row.purchaseValue, "purchaseValue");
    if (row.clicks > row.impressions) {
      throw new RangeError("clicks cannot exceed impressions in a device row.");
    }

    const existing = grouped.get(row.device);
    if (!existing) {
      grouped.set(row.device, { ...row });
      continue;
    }
    existing.spend += row.spend;
    existing.impressions += row.impressions;
    existing.clicks += row.clicks;
    existing.registrations = addNullable(existing.registrations, row.registrations);
    existing.purchases = addNullable(existing.purchases, row.purchases);
    existing.purchaseValue = addNullable(existing.purchaseValue, row.purchaseValue);
  }

  const totalSpend = [...grouped.values()].reduce((total, row) => total + row.spend, 0);
  const anomalies: DevicePerformanceAnomaly[] = [];
  const rows = DEVICE_ORDER.map<DevicePerformanceRow>((device) => {
    const source = grouped.get(device) ?? {
      device,
      spend: 0,
      impressions: 0,
      clicks: 0,
      registrations: null,
      purchases: null,
      purchaseValue: null,
    };
    const rowAnomalies: DevicePerformanceAnomaly[] = [];
    if (source.spend > 0 && source.clicks === 0) {
      rowAnomalies.push({
        code: "spend_without_clicks",
        device,
        severity: "warning",
        message: `${DEVICE_LABELS[device]} recorded spend but no clicks; verify inventory quality and reporting grain.`,
      });
    }
    anomalies.push(...rowAnomalies);
    const conversions = addNullable(source.registrations, source.purchases);
    const hasActivity = source.spend > 0 || source.impressions > 0 || source.clicks > 0;
    const status: TrafficLightStatus = rowAnomalies.length > 0
      ? { tone: "amber", level: "watch", label: "Spend without clicks" }
      : hasActivity
        ? { tone: "green", level: "healthy", label: "Reported" }
        : { tone: "neutral", level: "no_data", label: "No activity" };

    return {
      ...source,
      label: DEVICE_LABELS[device],
      ctrRatio: source.impressions === 0 ? null : round(source.clicks / source.impressions),
      cpc: source.clicks === 0 ? null : round(source.spend / source.clicks, 2),
      conversionRate: source.clicks === 0 || conversions === null
        ? null
        : round(conversions / source.clicks),
      spendShareRatio: totalSpend === 0 ? 0 : round(source.spend / totalSpend),
      status,
      anomalies: rowAnomalies,
    };
  });

  const totalNullable = (
    read: (row: DevicePerformanceInputRow) => number | null,
  ): number | null => {
    let total = 0;
    for (const row of grouped.values()) {
      const value = read(row);
      if (value === null) return null;
      total += value;
    }
    return total;
  };

  return {
    platform: "google",
    range: input.range,
    currency: input.currency,
    sourceStatus: input.sourceStatus ?? "live",
    rows,
    totals: {
      spend: round(totalSpend, 2),
      impressions: [...grouped.values()].reduce((total, row) => total + row.impressions, 0),
      clicks: [...grouped.values()].reduce((total, row) => total + row.clicks, 0),
      registrations: totalNullable((row) => row.registrations),
      purchases: totalNullable((row) => row.purchases),
      purchaseValue: totalNullable((row) => row.purchaseValue),
    },
    anomalies,
  };
}
