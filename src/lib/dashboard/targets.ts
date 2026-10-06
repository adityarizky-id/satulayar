/**
 * Editable acquisition targets. The 30 defaults are product defaults that
 * stay in each account's own currency, never converted. The
 * conversion-rate target has no locked value yet, so it is a working default
 * the reader can change.
 */
export interface PerformanceTargets {
  /** Cost per order (a purchase), in the account's own currency. */
  costPerOrder: number;
  /** Cost per acquisition (a registration), in the account's own currency. */
  costPerAcquisition: number;
  /** All-conversion rate floor, stored as a fraction of clicks. */
  conversionRate: number;
}

export const DEFAULT_TARGETS: PerformanceTargets = {
  costPerOrder: 30,
  costPerAcquisition: 30,
  conversionRate: 0.05,
};

/** How far past a target still counts as "near" instead of a straight fail. */
export const NEAR_MISS_TOLERANCE = 0.1;

export const TARGETS_COOKIE = "sl_targets";

function clampNumber(
  value: unknown,
  fallback: number,
  { min, max }: { min: number; max: number },
): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

export function normaliseTargets(
  input: Partial<Record<keyof PerformanceTargets, unknown>>,
): PerformanceTargets {
  return {
    costPerOrder: clampNumber(input.costPerOrder, DEFAULT_TARGETS.costPerOrder, {
      min: 0.01,
      max: 100_000,
    }),
    costPerAcquisition: clampNumber(
      input.costPerAcquisition,
      DEFAULT_TARGETS.costPerAcquisition,
      { min: 0.01, max: 100_000 },
    ),
    conversionRate: clampNumber(
      input.conversionRate,
      DEFAULT_TARGETS.conversionRate,
      { min: 0.0001, max: 1 },
    ),
  };
}

/** Reads the three target values from request query parameters. */
export function parseTargetsFromParams(
  params: URLSearchParams,
): PerformanceTargets {
  return normaliseTargets({
    costPerOrder: params.get("cpo") ?? undefined,
    costPerAcquisition: params.get("cpa") ?? undefined,
    conversionRate: params.get("cvr") ?? undefined,
  });
}

export function serialiseTargets(targets: PerformanceTargets): string {
  return [
    targets.costPerOrder,
    targets.costPerAcquisition,
    targets.conversionRate,
  ].join(",");
}

export function parseTargetsCookie(
  value: string | null | undefined,
): PerformanceTargets {
  if (!value) return DEFAULT_TARGETS;
  const [costPerOrder, costPerAcquisition, conversionRate] = value.split(",");

  return normaliseTargets({
    costPerOrder,
    costPerAcquisition,
    conversionRate,
  });
}
