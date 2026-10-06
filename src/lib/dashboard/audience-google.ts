import type { Currency, DateRange } from "@/lib/dashboard/types";

/**
 * Google Ads audience breakdown.
 *
 * Google reports age and gender as two separate demographics reports, not
 * one crossed grid the way Meta does, and a meaningful share of both is
 * `Unknown` — Display, YouTube, and Performance Max inventory frequently
 * cannot resolve a signed-out viewer's age or gender. That share is real
 * delivery, not a data-quality gap, so it is shown as its own row rather than
 * dropped or folded into another bucket. Segment performance (Affinity,
 * In-Market, Custom, Remarketing) is a third, separate cut: those are targeting
 * categories, not demographics.
 */
export type AgeBracket =
  | "18-24"
  | "25-34"
  | "35-44"
  | "45-54"
  | "55-64"
  | "65+"
  | "unknown";
export type Gender = "female" | "male" | "unknown";
export type SegmentTypeKey = "affinity" | "inMarket" | "custom" | "remarketing";

export const SEGMENT_TYPE_LABELS: Record<SegmentTypeKey, string> = {
  affinity: "Affinity",
  inMarket: "In-market",
  custom: "Custom segments",
  remarketing: "Remarketing",
};

const SEGMENT_TYPE_EXAMPLES: Record<SegmentTypeKey, string[]> = {
  affinity: ["Affinity: Shoppers — Gift & Novelty", "Affinity: Home & Garden Enthusiasts"],
  inMarket: ["In-market: Gifts & Occasions", "In-market: Home Decor"],
  custom: ["Custom segment: Competitor shoppers", "Custom segment: Gift-search intent"],
  remarketing: ["Remarketing: Site visitors 30d", "Remarketing: Cart abandoners"],
};

export interface DemographicRow {
  key: string;
  label: string;
  isUnknown: boolean;
  spend: number;
  impressions: number;
  clicks: number;
  registrations: number;
  purchases: number;
  purchaseValue: number;
  ctr: number | null;
  costPerPurchase: number | null;
  returnOnAdSpend: number | null;
  spendShare: number;
}

export interface SegmentRow {
  key: string;
  label: string;
  examples: string[];
  spend: number;
  impressions: number;
  clicks: number;
  registrations: number;
  purchases: number;
  purchaseValue: number;
  ctr: number | null;
  costPerPurchase: number | null;
  costPerRegistration: number | null;
  returnOnAdSpend: number | null;
  spendShare: number;
  purchaseShare: number;
}

export interface GoogleAudienceAnalysis {
  platform: "google";
  /** Whether the panel is backed by stored Google rows or fixture modelling. */
  source: "measured" | "modelled";
  range: DateRange;
  currency: Currency;
  ageRows: DemographicRow[];
  genderRows: DemographicRow[];
  segments: SegmentRow[];
  totals: {
    spend: number;
    purchases: number;
    registrations: number;
    purchaseValue: number;
  };
  unknownAgeShare: number;
  unknownGenderShare: number;
  safeMessage: string;
}

/**
 * The client-safe audience shape returned by the Supabase reader. Kept here
 * instead of importing the server-only DAL into dashboard analysis code.
 */
export interface StoredGoogleAudienceRow {
  date: string;
  campaignKey: string;
  adGroupKey: string;
  criterionId: string;
  criterionType: string | null;
  displayName: string | null;
  currency: Currency;
  spend: number;
  impressions: number;
  clicks: number;
  registrations: number | null;
  purchases: number | null;
  orderConversionValue: number | null;
  conversionActionFiltered: boolean;
  isProvisional: boolean;
}

interface DemographicShape {
  key: string;
  label: string;
  isUnknown: boolean;
  spendShare: number;
  /** Conversion rate relative to the account average, where 1 is average. */
  conversionIndex: number;
}

// Shares sum to 1 per dimension. Unknown carries real spend and a below-average
// conversion index (lower-intent Display/YouTube inventory tends to sit here).
const AGE_SHAPES: DemographicShape[] = [
  { key: "unknown", label: "Unknown", isUnknown: true, spendShare: 0.28, conversionIndex: 0.7 },
  { key: "18-24", label: "18-24", isUnknown: false, spendShare: 0.06, conversionIndex: 0.65 },
  { key: "25-34", label: "25-34", isUnknown: false, spendShare: 0.19, conversionIndex: 1.25 },
  { key: "35-44", label: "35-44", isUnknown: false, spendShare: 0.17, conversionIndex: 1.2 },
  { key: "45-54", label: "45-54", isUnknown: false, spendShare: 0.13, conversionIndex: 1.0 },
  { key: "55-64", label: "55-64", isUnknown: false, spendShare: 0.1, conversionIndex: 0.85 },
  { key: "65+", label: "65+", isUnknown: false, spendShare: 0.07, conversionIndex: 0.6 },
];

const GENDER_SHAPES: DemographicShape[] = [
  { key: "unknown", label: "Unknown", isUnknown: true, spendShare: 0.22, conversionIndex: 0.75 },
  { key: "female", label: "Female", isUnknown: false, spendShare: 0.48, conversionIndex: 1.15 },
  { key: "male", label: "Male", isUnknown: false, spendShare: 0.3, conversionIndex: 0.95 },
];

interface SegmentShape {
  key: SegmentTypeKey;
  spendShare: number;
  /** Cost per order relative to the account, where 1 is the account average. */
  costIndex: number;
}

// Remarketing (a warm list) runs cheapest; Affinity (broadest, awareness-shaped)
// runs the most expensive per order, the usual Google segment pattern.
const SEGMENT_SHAPES: SegmentShape[] = [
  { key: "affinity", spendShare: 0.22, costIndex: 1.4 },
  { key: "inMarket", spendShare: 0.33, costIndex: 0.9 },
  { key: "custom", spendShare: 0.2, costIndex: 1.05 },
  { key: "remarketing", spendShare: 0.25, costIndex: 0.5 },
];

function safeDivide(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function buildDemographicRows(
  shapes: DemographicShape[],
  input: {
    googleSpend: number;
    googleImpressions: number;
    googleClicks: number;
    googlePurchases: number;
    googleRegistrations: number;
    averageOrderValue: number;
  },
): DemographicRow[] {
  const weightTotal = shapes.reduce(
    (total, shape) => total + shape.spendShare * shape.conversionIndex,
    0,
  );

  const rows = shapes.map<DemographicRow>((shape) => {
    const weight =
      weightTotal === 0 ? 0 : (shape.spendShare * shape.conversionIndex) / weightTotal;
    const spend = round(input.googleSpend * shape.spendShare);
    const impressions = Math.round(input.googleImpressions * shape.spendShare);
    const clicks = Math.round(input.googleClicks * shape.spendShare);
    const purchases = Math.round(input.googlePurchases * weight);
    const registrations = Math.round(input.googleRegistrations * weight);
    const purchaseValue = round(purchases * input.averageOrderValue);

    return {
      key: shape.key,
      label: shape.label,
      isUnknown: shape.isUnknown,
      spend,
      impressions,
      clicks,
      registrations,
      purchases,
      purchaseValue,
      ctr: safeDivide(clicks, impressions),
      costPerPurchase: safeDivide(spend, purchases),
      returnOnAdSpend: safeDivide(purchaseValue, spend),
      spendShare: 0,
    };
  });

  const spendTotal = rows.reduce((total, row) => total + row.spend, 0);
  return rows
    .map((row) => ({
      ...row,
      spendShare: spendTotal === 0 ? 0 : row.spend / spendTotal,
    }))
    .toSorted((left, right) => right.spend - left.spend);
}

export function buildGoogleAudienceAnalysis(input: {
  range: DateRange;
  currency: Currency;
  googleSpend: number;
  googleImpressions: number;
  googleClicks: number;
  googlePurchases: number;
  googleRegistrations: number;
  googlePurchaseValue: number;
}): GoogleAudienceAnalysis {
  const averageOrderValue =
    input.googlePurchases === 0 ? 0 : input.googlePurchaseValue / input.googlePurchases;

  const ageRows = buildDemographicRows(AGE_SHAPES, { ...input, averageOrderValue });
  const genderRows = buildDemographicRows(GENDER_SHAPES, { ...input, averageOrderValue });

  const segmentWeightTotal = SEGMENT_SHAPES.reduce(
    (total, shape) => total + shape.spendShare / shape.costIndex,
    0,
  );
  const segments = SEGMENT_SHAPES.map<SegmentRow>((shape) => {
    const weight =
      segmentWeightTotal === 0
        ? 0
        : shape.spendShare / shape.costIndex / segmentWeightTotal;
    const spend = round(input.googleSpend * shape.spendShare);
    const impressions = Math.round(input.googleImpressions * shape.spendShare);
    const clicks = Math.round(input.googleClicks * shape.spendShare);
    const purchases = Math.round(input.googlePurchases * weight);
    const registrations = Math.round(input.googleRegistrations * weight);
    const purchaseValue = round(purchases * averageOrderValue);

    return {
      key: shape.key,
      label: SEGMENT_TYPE_LABELS[shape.key],
      examples: SEGMENT_TYPE_EXAMPLES[shape.key],
      spend,
      impressions,
      clicks,
      registrations,
      purchases,
      purchaseValue,
      ctr: safeDivide(clicks, impressions),
      costPerPurchase: safeDivide(spend, purchases),
      costPerRegistration: safeDivide(spend, registrations),
      returnOnAdSpend: safeDivide(purchaseValue, spend),
      spendShare: 0,
      purchaseShare: 0,
    };
  });
  const segmentSpendTotal = segments.reduce((total, row) => total + row.spend, 0);
  const segmentPurchaseTotal = segments.reduce(
    (total, row) => total + row.purchases,
    0,
  );
  const withSegmentShares = segments
    .map((row) => ({
      ...row,
      spendShare: segmentSpendTotal === 0 ? 0 : row.spend / segmentSpendTotal,
      purchaseShare:
        segmentPurchaseTotal === 0 ? 0 : row.purchases / segmentPurchaseTotal,
    }))
    .toSorted((left, right) => right.spend - left.spend);

  const cheapestSegment =
    input.googlePurchases === 0
      ? null
      : withSegmentShares.toSorted(
          (left, right) => (left.costPerPurchase ?? Infinity) - (right.costPerPurchase ?? Infinity),
        )[0];
  const unknownAge = ageRows.find((row) => row.isUnknown);
  const unknownGender = genderRows.find((row) => row.isUnknown);

  return {
    platform: "google",
    source: "modelled",
    range: input.range,
    currency: input.currency,
    ageRows,
    genderRows,
    segments: withSegmentShares,
    totals: {
      spend: round(input.googleSpend),
      purchases: input.googlePurchases,
      registrations: input.googleRegistrations,
      purchaseValue: round(input.googlePurchaseValue),
    },
    unknownAgeShare: unknownAge?.spendShare ?? 0,
    unknownGenderShare: unknownGender?.spendShare ?? 0,
    safeMessage:
      input.googlePurchases === 0
        ? "No Google purchases in this period, so no age, gender, or segment can be judged yet."
        : `${Math.round((unknownAge?.spendShare ?? 0) * 100)}% of spend has no resolvable age and ${Math.round((unknownGender?.spendShare ?? 0) * 100)}% no resolvable gender — mostly Display and video inventory, not a tracking gap. ${cheapestSegment?.label} runs the cheapest cost per order among the four segment types.`,
  };
}

const CRITERION_TYPE_LABELS: Record<string, string> = {
  AFFINITY: "Affinity",
  COMBINED_AUDIENCE: "Combined audience",
  CUSTOM_AUDIENCE: "Custom audience",
  CUSTOM_INTENT: "Custom intent",
  IN_MARKET: "In-market",
  LIFE_EVENT: "Life event",
  USER_INTEREST: "Interest segment",
  USER_LIST: "Remarketing / customer list",
};

function criterionTypeLabel(value: string | null): string {
  if (!value) return "Audience segment";
  return (
    CRITERION_TYPE_LABELS[value] ??
    value
      .toLowerCase()
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
  );
}

/**
 * Builds the live panel from Google `ad_group_audience_view` rows.
 *
 * This feed does not contain age or gender. Those arrays deliberately stay
 * empty so the UI cannot present modelled demographics as measured data.
 * Conversion fields must be action-filtered and complete for every row; an
 * incomplete pull returns null and leaves the section visibly pending.
 */
export function buildGoogleAudienceAnalysisFromRows(input: {
  rows: readonly StoredGoogleAudienceRow[];
  range: DateRange;
  currency: Currency;
}): GoogleAudienceAnalysis | null {
  const rows = input.rows.filter(
    (row) => row.date >= input.range.start && row.date <= input.range.end,
  );

  if (rows.length === 0) return null;
  if (
    rows.some(
      (row) =>
        row.currency !== input.currency ||
        !row.conversionActionFiltered ||
        row.registrations === null ||
        row.purchases === null ||
        row.orderConversionValue === null,
    )
  ) {
    return null;
  }

  type SegmentAccumulator = {
    key: string;
    label: string;
    criterionType: string | null;
    spend: number;
    impressions: number;
    clicks: number;
    registrations: number;
    purchases: number;
    purchaseValue: number;
  };

  const byCriterion = new Map<string, SegmentAccumulator>();
  for (const row of rows) {
    const key = `${row.criterionType ?? "unknown"}:${row.criterionId}`;
    const current = byCriterion.get(key) ?? {
      key,
      label: row.displayName?.trim() || criterionTypeLabel(row.criterionType),
      criterionType: row.criterionType,
      spend: 0,
      impressions: 0,
      clicks: 0,
      registrations: 0,
      purchases: 0,
      purchaseValue: 0,
    };

    current.spend += row.spend;
    current.impressions += row.impressions;
    current.clicks += row.clicks;
    current.registrations += row.registrations ?? 0;
    current.purchases += row.purchases ?? 0;
    current.purchaseValue += row.orderConversionValue ?? 0;
    byCriterion.set(key, current);
  }

  const segmentSpendTotal = [...byCriterion.values()].reduce(
    (total, row) => total + row.spend,
    0,
  );
  const segmentPurchaseTotal = [...byCriterion.values()].reduce(
    (total, row) => total + row.purchases,
    0,
  );
  const segments = [...byCriterion.values()]
    .map<SegmentRow>((row) => ({
      key: row.key,
      label: row.label,
      examples: [criterionTypeLabel(row.criterionType)],
      spend: round(row.spend),
      impressions: row.impressions,
      clicks: row.clicks,
      registrations: round(row.registrations, 4),
      purchases: round(row.purchases, 4),
      purchaseValue: round(row.purchaseValue),
      ctr: safeDivide(row.clicks, row.impressions),
      costPerPurchase: safeDivide(row.spend, row.purchases),
      costPerRegistration: safeDivide(row.spend, row.registrations),
      returnOnAdSpend: safeDivide(row.purchaseValue, row.spend),
      spendShare:
        segmentSpendTotal === 0 ? 0 : row.spend / segmentSpendTotal,
      purchaseShare:
        segmentPurchaseTotal === 0 ? 0 : row.purchases / segmentPurchaseTotal,
    }))
    .toSorted((left, right) => right.spend - left.spend);

  const provisionalRows = rows.filter((row) => row.isProvisional).length;

  return {
    platform: "google",
    source: "measured",
    range: input.range,
    currency: input.currency,
    ageRows: [],
    genderRows: [],
    segments,
    totals: {
      spend: round(segmentSpendTotal),
      purchases: round(segmentPurchaseTotal, 4),
      registrations: round(
        segments.reduce((total, row) => total + row.registrations, 0),
        4,
      ),
      purchaseValue: round(
        segments.reduce((total, row) => total + row.purchaseValue, 0),
      ),
    },
    unknownAgeShare: 0,
    unknownGenderShare: 0,
    safeMessage: `Measured from Google Ads audience-segment reporting. People can match more than one segment, so use these rows diagnostically and do not add them to account totals.${
      provisionalRows > 0
        ? ` ${provisionalRows} open-day row${provisionalRows === 1 ? " is" : "s are"} provisional.`
        : ""
    }`,
  };
}
