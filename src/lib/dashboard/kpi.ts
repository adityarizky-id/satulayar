import type {
  DailyMetric,
  DateRange,
  MetricTotals,
  Platform,
} from "@/lib/dashboard/types";

export function safeDivide(
  numerator: number,
  denominator: number,
): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function weightedAverage(
  rows: readonly DailyMetric[],
  read: (row: DailyMetric) => number | undefined,
): number | null {
  let weighted = 0;
  let weight = 0;

  for (const row of rows) {
    const value = read(row);
    if (value === undefined) continue;
    weighted += value * row.impressions;
    weight += row.impressions;
  }

  return weight === 0 ? null : weighted / weight;
}

function dailyAverage(
  rows: readonly DailyMetric[],
  read: (row: DailyMetric) => number | undefined,
): number | null {
  const values = rows
    .map(read)
    .filter((value): value is number => value !== undefined);

  if (values.length === 0) return null;
  // Reach is deduplicated per day by the platform and cannot be summed across
  // days without double counting people, so the honest roll-up is an average.
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/**
 * Sums a nullable value. Null when no row measured it, so a scope where the
 * action is not mapped reads "not measured" instead of a confident 0.
 */
function sumMeasured(
  rows: readonly DailyMetric[],
  read: (row: DailyMetric) => number | null | undefined,
): number | null {
  let total: number | null = null;
  for (const row of rows) {
    const value = read(row);
    if (value === null || value === undefined) continue;
    total = (total ?? 0) + value;
  }
  return total;
}

/**
 * Divides where either side may be unmeasured. A ratio built on a metric no
 * source reported is itself unmeasured, never 0 — otherwise an account with no
 * landing-page tag reads as a total funnel collapse rather than a blind spot.
 */
function divideMeasured(
  numerator: number | null,
  denominator: number | null,
): number | null {
  if (numerator === null || denominator === null) return null;
  return safeDivide(numerator, denominator);
}

export function aggregateMetrics(rows: DailyMetric[]): MetricTotals {
  const summed = rows.reduce(
    (totals, row) => ({
      spend: totals.spend + row.spend,
      impressions: totals.impressions + row.impressions,
      clicks: totals.clicks + row.clicks,
      registrations: totals.registrations + row.registrations,
      purchases: totals.purchases + row.purchases,
      platformConversionValue:
        totals.platformConversionValue + row.platformConversionValue,
      actualPurchaseRevenue:
        totals.actualPurchaseRevenue + row.actualPurchaseRevenue,
    }),
    {
      spend: 0,
      impressions: 0,
      clicks: 0,
      registrations: 0,
      purchases: 0,
      platformConversionValue: 0,
      actualPurchaseRevenue: 0,
    },
  );

  const cpm = safeDivide(summed.spend, summed.impressions);
  // Landing page views are not universally reported: Meta derives them from
  // its pixel, while a Google account only has them once a page-view
  // conversion action is mapped and firing. Summing as "not measured" keeps an
  // unmapped account from reading as zero visits to a site that is plainly
  // taking orders.
  const landingPageViews = sumMeasured(rows, (row) => row.landingPageViews);
  const engagedVisits = sumMeasured(rows, (row) => row.engagedVisits);
  const addToBaskets = sumMeasured(rows, (row) => row.addToBaskets);
  // The locked contract counts registrations and purchases on the all
  // conversions basis, so the all-conversion rate adds both over clicks.
  const allConversions = summed.registrations + summed.purchases;

  const averageDailyReach = dailyAverage(rows, (row) => row.reach);
  const averageDailyFrequency = dailyAverage(rows, (row) =>
    row.reach === undefined || row.reach === 0
      ? undefined
      : row.impressions / row.reach,
  );

  return {
    ...summed,
    landingPageViews,
    engagedVisits,
    addToBaskets,
    orderConversionValue: sumMeasured(rows, (row) => row.orderConversionValue),
    registrationLeadValue: sumMeasured(rows, (row) => row.registrationLeadValue),
    allConversions,
    allConversionRate: safeDivide(allConversions, summed.clicks),
    averageDailyReach,
    averageDailyFrequency,
    impressionShare: weightedAverage(rows, (row) => row.searchImpressionShare),
    impressionShareLostToRank: weightedAverage(
      rows,
      (row) => row.impressionShareLostToRank,
    ),
    impressionShareLostToBudget: weightedAverage(
      rows,
      (row) => row.impressionShareLostToBudget,
    ),
    platformValueRatio: safeDivide(
      summed.platformConversionValue,
      summed.actualPurchaseRevenue,
    ),
    ctr: safeDivide(summed.clicks, summed.impressions),
    cpc: safeDivide(summed.spend, summed.clicks),
    cpm: cpm === null ? null : cpm * 1_000,
    costPerLandingPageView: divideMeasured(summed.spend, landingPageViews),
    costPerAddToBasket: divideMeasured(summed.spend, addToBaskets),
    costPerRegistration: safeDivide(summed.spend, summed.registrations),
    costPerPurchase: safeDivide(summed.spend, summed.purchases),
    clickToLpvRate: divideMeasured(landingPageViews, summed.clicks),
    lpvToBasketRate: divideMeasured(addToBaskets, landingPageViews),
    lpvToRegistrationRate: divideMeasured(
      summed.registrations,
      landingPageViews,
    ),
    registrationToPurchaseRate: safeDivide(
      summed.purchases,
      summed.registrations,
    ),
    clickToPurchaseRate: safeDivide(summed.purchases, summed.clicks),
    averageOrderValue: safeDivide(
      summed.actualPurchaseRevenue,
      summed.purchases,
    ),
    actualRevenueRoas: safeDivide(
      summed.actualPurchaseRevenue,
      summed.spend,
    ),
    platformRoas: safeDivide(summed.platformConversionValue, summed.spend),
  };
}

export function filterMetricRows(
  rows: DailyMetric[],
  range: DateRange,
  platform: Platform,
): DailyMetric[] {
  return rows.filter(
    (row) =>
      row.date >= range.start &&
      row.date <= range.end &&
      (platform === "all" || row.platform === platform),
  );
}

export function getPreviousPeriod(range: DateRange): DateRange {
  const start = new Date(`${range.start}T00:00:00Z`);
  const end = new Date(`${range.end}T00:00:00Z`);
  const inclusiveDays =
    Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;

  const comparisonEnd = new Date(start);
  comparisonEnd.setUTCDate(comparisonEnd.getUTCDate() - 1);

  const comparisonStart = new Date(comparisonEnd);
  comparisonStart.setUTCDate(
    comparisonStart.getUTCDate() - (inclusiveDays - 1),
  );

  return {
    start: comparisonStart.toISOString().slice(0, 10),
    end: comparisonEnd.toISOString().slice(0, 10),
  };
}

export function getPercentChange(
  current: number | null,
  previous: number | null,
): number | "new" | "no-change" | null {
  if (current === null || previous === null) return null;
  if (previous === 0 && current > 0) return "new";
  if (previous === 0 && current === 0) return "no-change";
  return ((current - previous) / previous) * 100;
}
