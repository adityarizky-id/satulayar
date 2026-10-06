import type { Currency, DateRange } from "@/lib/dashboard/types";

/**
 * Meta Ads audience breakdown.
 *
 * Meta Ads Manager's own breakdown table crosses age and gender into one
 * grid, so the demographic cut below does the same instead of splitting them
 * into two reports the way Google's does. Meta also reports which audience
 * type (Core, Custom, Lookalike) each ad set targets; that is a separate cut
 * because a Core interest audience and a Custom retargeting list are not
 * comparable categories.
 */
export type AgeBracket = "18-24" | "25-34" | "35-44" | "45-54" | "55-64" | "65+";
export type Gender = "female" | "male";
export type AudienceTypeKey = "core" | "custom" | "lookalike";

export const AUDIENCE_TYPE_LABELS: Record<AudienceTypeKey, string> = {
  core: "Core audiences",
  custom: "Custom audiences",
  lookalike: "Lookalike audiences",
};

const AUDIENCE_TYPE_EXAMPLES: Record<AudienceTypeKey, string[]> = {
  core: ["Interest: Coffee & specialty drinks", "Broad — Indonesia adults 25-54"],
  custom: ["Website visitors — 180 days", "Email list — past purchasers"],
  lookalike: ["1% ID lookalike — purchasers", "2% ID lookalike — high LTV"],
};

export interface DemographicRow {
  key: string;
  age: AgeBracket;
  gender: Gender;
  label: string;
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

export interface AudienceTypeRow {
  key: AudienceTypeKey;
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

export interface MetaAudienceAnalysis {
  platform: "meta";
  range: DateRange;
  currency: Currency;
  demographics: DemographicRow[];
  audienceTypes: AudienceTypeRow[];
  totals: {
    spend: number;
    purchases: number;
    registrations: number;
    purchaseValue: number;
  };
  topDemographic: DemographicRow | null;
  safeMessage: string;
}

interface DemographicShape {
  age: AgeBracket;
  gender: Gender;
  spendShare: number;
  /** Conversion rate relative to the account average, where 1 is average. */
  conversionIndex: number;
}

// Shares sum to 1. Shaped for a DTC account: spend and efficiency both
// concentrate in 25-44 female, the account's known-strongest segment.
const DEMOGRAPHIC_SHAPES: DemographicShape[] = [
  { age: "18-24", gender: "female", spendShare: 0.05, conversionIndex: 0.75 },
  { age: "25-34", gender: "female", spendShare: 0.22, conversionIndex: 1.35 },
  { age: "35-44", gender: "female", spendShare: 0.19, conversionIndex: 1.25 },
  { age: "45-54", gender: "female", spendShare: 0.12, conversionIndex: 1.05 },
  { age: "55-64", gender: "female", spendShare: 0.07, conversionIndex: 0.85 },
  { age: "65+", gender: "female", spendShare: 0.03, conversionIndex: 0.55 },
  { age: "18-24", gender: "male", spendShare: 0.03, conversionIndex: 0.6 },
  { age: "25-34", gender: "male", spendShare: 0.09, conversionIndex: 0.95 },
  { age: "35-44", gender: "male", spendShare: 0.08, conversionIndex: 0.9 },
  { age: "45-54", gender: "male", spendShare: 0.06, conversionIndex: 0.8 },
  { age: "55-64", gender: "male", spendShare: 0.04, conversionIndex: 0.7 },
  { age: "65+", gender: "male", spendShare: 0.02, conversionIndex: 0.5 },
];

interface AudienceTypeShape {
  key: AudienceTypeKey;
  spendShare: number;
  /** Cost per order relative to the account, where 1 is the account average. */
  costIndex: number;
}

// Custom (retargeting a warm list) runs cheapest; Core (broad/interest) runs
// the most expensive per order, which is the usual Meta pattern.
const AUDIENCE_TYPE_SHAPES: AudienceTypeShape[] = [
  { key: "core", spendShare: 0.35, costIndex: 1.3 },
  { key: "custom", spendShare: 0.3, costIndex: 0.55 },
  { key: "lookalike", spendShare: 0.35, costIndex: 0.95 },
];

function safeDivide(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function buildMetaAudienceAnalysis(input: {
  range: DateRange;
  currency: Currency;
  metaSpend: number;
  metaImpressions: number;
  metaClicks: number;
  metaPurchases: number;
  metaRegistrations: number;
  metaPurchaseValue: number;
}): MetaAudienceAnalysis {
  const averageOrderValue =
    input.metaPurchases === 0 ? 0 : input.metaPurchaseValue / input.metaPurchases;

  const demographicWeightTotal = DEMOGRAPHIC_SHAPES.reduce(
    (total, shape) => total + shape.spendShare * shape.conversionIndex,
    0,
  );
  const demographics = DEMOGRAPHIC_SHAPES.map<DemographicRow>((shape) => {
    const weight =
      demographicWeightTotal === 0
        ? 0
        : (shape.spendShare * shape.conversionIndex) / demographicWeightTotal;
    const spend = round(input.metaSpend * shape.spendShare);
    const impressions = Math.round(input.metaImpressions * shape.spendShare);
    const clicks = Math.round(input.metaClicks * shape.spendShare);
    const purchases = Math.round(input.metaPurchases * weight);
    const registrations = Math.round(input.metaRegistrations * weight);
    const purchaseValue = round(purchases * averageOrderValue);

    return {
      key: `${shape.age}-${shape.gender}`,
      age: shape.age,
      gender: shape.gender,
      label: `${shape.gender === "female" ? "Female" : "Male"} ${shape.age}`,
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
  const demographicSpendTotal = demographics.reduce(
    (total, row) => total + row.spend,
    0,
  );
  const withDemographicShares = demographics
    .map((row) => ({
      ...row,
      spendShare: demographicSpendTotal === 0 ? 0 : row.spend / demographicSpendTotal,
    }))
    .toSorted((left, right) => right.spend - left.spend);

  const typeWeightTotal = AUDIENCE_TYPE_SHAPES.reduce(
    (total, shape) => total + shape.spendShare / shape.costIndex,
    0,
  );
  const audienceTypes = AUDIENCE_TYPE_SHAPES.map<AudienceTypeRow>((shape) => {
    const weight =
      typeWeightTotal === 0 ? 0 : shape.spendShare / shape.costIndex / typeWeightTotal;
    const spend = round(input.metaSpend * shape.spendShare);
    const impressions = Math.round(input.metaImpressions * shape.spendShare);
    const clicks = Math.round(input.metaClicks * shape.spendShare);
    const purchases = Math.round(input.metaPurchases * weight);
    const registrations = Math.round(input.metaRegistrations * weight);
    const purchaseValue = round(purchases * averageOrderValue);

    return {
      key: shape.key,
      label: AUDIENCE_TYPE_LABELS[shape.key],
      examples: AUDIENCE_TYPE_EXAMPLES[shape.key],
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
  const typeSpendTotal = audienceTypes.reduce((total, row) => total + row.spend, 0);
  const typePurchaseTotal = audienceTypes.reduce(
    (total, row) => total + row.purchases,
    0,
  );
  const withTypeShares = audienceTypes
    .map((row) => ({
      ...row,
      spendShare: typeSpendTotal === 0 ? 0 : row.spend / typeSpendTotal,
      purchaseShare: typePurchaseTotal === 0 ? 0 : row.purchases / typePurchaseTotal,
    }))
    .toSorted((left, right) => right.spend - left.spend);

  const topDemographic =
    input.metaPurchases === 0 ? null : (withDemographicShares[0] ?? null);
  const cheapestType =
    input.metaPurchases === 0
      ? null
      : withTypeShares.toSorted(
          (left, right) => (left.costPerPurchase ?? Infinity) - (right.costPerPurchase ?? Infinity),
        )[0];

  return {
    platform: "meta",
    range: input.range,
    currency: input.currency,
    demographics: withDemographicShares,
    audienceTypes: withTypeShares,
    totals: {
      spend: round(input.metaSpend),
      purchases: input.metaPurchases,
      registrations: input.metaRegistrations,
      purchaseValue: round(input.metaPurchaseValue),
    },
    topDemographic,
    safeMessage:
      input.metaPurchases === 0
        ? "No Meta purchases in this period, so no age, gender, or audience type can be judged yet."
        : `${topDemographic?.label} is the largest audience by spend. ${cheapestType?.label} runs the cheapest cost per order among the three targeting types.`,
  };
}
