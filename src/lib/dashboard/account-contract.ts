import {
  DEFAULT_TARGETS,
  NEAR_MISS_TOLERANCE,
  type PerformanceTargets,
} from "@/lib/dashboard/targets";
import type {
  AcquisitionGuardrailReport,
  Currency,
  DailyMetric,
  GuardrailCheck,
  GuardrailStatus,
  MetricTotals,
  Platform,
} from "@/lib/dashboard/types";

/**
 * Acquisition guardrail: 30 in each account's own reporting
 * currency. It is never converted, so an account reporting EUR is judged
 * against 30 EUR and never against a GBP equivalent.
 */
export const ACQUISITION_GUARDRAIL_AMOUNT = 30;

export function formatCurrency(
  value: number,
  currency: Currency,
  fractionDigits = 0,
): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

export interface PlatformConversionContract {
  platform: Exclude<Platform, "all">;
  purchaseSource: string;
  registrationSource: string;
  viewThroughBasis: "included" | "account-attribution-setting";
  safeMessage: string;
}

/**
 * Conversion definitions. The two platforms count on
 * different bases, so their conversion counts are not directly comparable and
 * must never be summed into a unique-customer figure.
 */
export const PLATFORM_CONVERSION_CONTRACTS: Record<
  Exclude<Platform, "all">,
  PlatformConversionContract
> = {
  google: {
    platform: "google",
    purchaseSource: "All conversions",
    registrationSource: "All conversions",
    viewThroughBasis: "included",
    safeMessage:
      "Google reports the All conversions column, which already includes view-through conversions.",
  },
  meta: {
    platform: "meta",
    purchaseSource: "Ads Manager purchase",
    registrationSource: "Ads Manager registration",
    viewThroughBasis: "account-attribution-setting",
    safeMessage:
      "Meta reports its native purchase and registration metrics on the attribution setting that applies to the account.",
  },
};

export function getConversionContracts(
  platform: Platform,
): PlatformConversionContract[] {
  const platforms: Exclude<Platform, "all">[] =
    platform === "all" ? ["meta", "google"] : [platform];
  return platforms.map((item) => PLATFORM_CONVERSION_CONTRACTS[item]);
}

/**
 * Google and Meta counts share a column name, not a definition. A scope that
 * mixes both platforms carries an attribution caveat that the UI must show.
 */
export function conversionComparabilityCaveat(
  platform: Platform,
): string | null {
  if (platform !== "all") return null;
  return "Google counts All conversions including view-through while Meta counts on its own attribution setting. Combined totals are attributed counts, never deduplicated customers.";
}

export type ScopeCurrencyResolution =
  | { ok: true; currency: Currency }
  | { ok: false; currencies: Currency[] };

/**
 * Cost, spend, and revenue may only be aggregated inside a single reporting
 * currency. An empty scope falls back to the account contract so an empty
 * dashboard still labels its own currency.
 */
export function resolveScopeCurrency(
  rows: readonly DailyMetric[],
  fallback: Currency,
): ScopeCurrencyResolution {
  const currencies = [...new Set(rows.map((row) => row.currency))].toSorted();

  if (currencies.length === 0) return { ok: true, currency: fallback };
  if (currencies.length === 1) {
    return { ok: true, currency: currencies[0] as Currency };
  }

  return { ok: false, currencies: currencies as Currency[] };
}

interface CheckDefinition {
  metric: GuardrailCheck["metric"];
  label: string;
  shortLabel: string;
  unit: GuardrailCheck["unit"];
  favorableDirection: GuardrailCheck["favorableDirection"];
  target: number;
  value: number | null;
  /** Cost metrics cannot be judged when the scope mixes currencies. */
  needsSingleCurrency: boolean;
}

function formatTarget(
  target: number,
  unit: GuardrailCheck["unit"],
  currency: Currency,
): string {
  return unit === "percent"
    ? `${(target * 100).toFixed(1)}%`
    : `${target} ${currency}`;
}

function checkFor(
  definition: CheckDefinition,
  currency: Currency,
  costAggregationAllowed: boolean,
): GuardrailCheck {
  const base = {
    metric: definition.metric,
    label: definition.label,
    shortLabel: definition.shortLabel,
    target: definition.target,
    unit: definition.unit,
    favorableDirection: definition.favorableDirection,
    currency,
  };

  if (definition.needsSingleCurrency && !costAggregationAllowed) {
    return {
      ...base,
      value: null,
      status: "unavailable",
      safeMessage:
        "The selected scope mixes reporting currencies, so this cost target cannot be judged.",
    };
  }

  if (definition.value === null) {
    return {
      ...base,
      value: null,
      status: "unavailable",
      safeMessage: `No ${definition.label.toLowerCase()} is available for this period, so the target cannot be judged.`,
    };
  }

  const value = definition.value;
  const wantsLower = definition.favorableDirection === "lower";
  const nearLimit = wantsLower
    ? definition.target * (1 + NEAR_MISS_TOLERANCE)
    : definition.target * (1 - NEAR_MISS_TOLERANCE);
  const meetsTarget = wantsLower
    ? value <= definition.target
    : value >= definition.target;
  const isNear = wantsLower ? value <= nearLimit : value >= nearLimit;
  const status: GuardrailStatus = meetsTarget
    ? "pass"
    : isNear
      ? "near"
      : "breach";
  const targetLabel = formatTarget(definition.target, definition.unit, currency);

  return {
    ...base,
    value,
    status,
    safeMessage:
      status === "pass"
        ? `${definition.label} meets the ${targetLabel} target.`
        : status === "near"
          ? `${definition.label} is within ${Math.round(
              NEAR_MISS_TOLERANCE * 100,
            )}% of the ${targetLabel} target but has not met it.`
          : `${definition.label} misses the ${targetLabel} target.`,
  };
}

function rollUpStatus(checks: readonly GuardrailCheck[]): GuardrailStatus {
  if (checks.some((check) => check.status === "breach")) return "breach";
  if (checks.some((check) => check.status === "near")) return "near";
  if (checks.some((check) => check.status === "pass")) return "pass";
  return "unavailable";
}

/**
 * Judges the reader's own targets: cost per order, cost per acquisition, and
 * the all-conversion rate floor. Cost targets stay in the scope's currency and
 * are never converted.
 */
export function evaluateAcquisitionGuardrail(
  totals: MetricTotals,
  scope: { currency: Currency; costAggregationAllowed: boolean },
  targets: PerformanceTargets = DEFAULT_TARGETS,
): AcquisitionGuardrailReport {
  const definitions: CheckDefinition[] = [
    {
      metric: "costPerPurchase",
      label: "Cost per order",
      shortLabel: "CPO",
      unit: "currency",
      favorableDirection: "lower",
      target: targets.costPerOrder,
      value: totals.costPerPurchase,
      needsSingleCurrency: true,
    },
    {
      metric: "costPerRegistration",
      label: "Cost per acquisition",
      shortLabel: "CPA",
      unit: "currency",
      favorableDirection: "lower",
      target: targets.costPerAcquisition,
      value: totals.costPerRegistration,
      needsSingleCurrency: true,
    },
    {
      metric: "conversionRate",
      label: "All conversion rate",
      shortLabel: "Conv. rate",
      unit: "percent",
      favorableDirection: "higher",
      target: targets.conversionRate,
      value: totals.allConversionRate,
      needsSingleCurrency: false,
    },
  ];

  const checks = definitions.map((definition) =>
    checkFor(definition, scope.currency, scope.costAggregationAllowed),
  );
  const status = rollUpStatus(checks);
  const failing = checks.filter((check) => check.status === "breach");
  const nearMisses = checks.filter((check) => check.status === "near");

  return {
    threshold: targets.costPerOrder,
    targets: {
      costPerOrder: targets.costPerOrder,
      costPerAcquisition: targets.costPerAcquisition,
      conversionRate: targets.conversionRate,
    },
    currency: scope.currency,
    costAggregationAllowed: scope.costAggregationAllowed,
    status,
    checks,
    safeMessage: !scope.costAggregationAllowed
      ? "Cost targets are unavailable because the scope mixes reporting currencies."
      : status === "breach"
        ? `Missing target: ${failing
            .map((check) => check.shortLabel)
            .join(", ")}.`
        : status === "near"
          ? `Close but not there yet: ${nearMisses
              .map((check) => check.shortLabel)
              .join(", ")}.`
          : status === "pass"
            ? "Every target is met for this period."
            : "Not enough volume to judge the targets.",
  };
}
