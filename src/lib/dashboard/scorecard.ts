import { volumeVerdict } from "@/lib/dashboard/confidence";
import type {
  JourneyStage,
  JourneyStageDefinition,
  MetricCardData,
  MetricTotals,
  Platform,
} from "@/lib/dashboard/types";

/**
 * The scorecard is ordered by the customer journey: money in, then reach,
 * then each step a person takes before revenue comes out. Every stage answers
 * one question so a reader knows which step is leaking.
 */
export const JOURNEY_STAGES: JourneyStageDefinition[] = [
  {
    stage: "investment",
    label: "Investment",
    question: "How much did we put in?",
  },
  {
    stage: "reach",
    label: "Reach",
    question: "How many times were we seen, and at what price?",
  },
  {
    stage: "engagement",
    label: "Engagement",
    question: "Who reacted to the ad, and what did each reaction cost?",
  },
  {
    stage: "consideration",
    label: "Consideration",
    question: "Who actually landed on the site and stayed?",
  },
  {
    stage: "acquisition",
    label: "Acquisition",
    question: "Who registered or bought, and at what acquisition cost?",
  },
  {
    stage: "revenue",
    label: "Revenue",
    question: "What came back, per order and per unit of spend?",
  },
];

const MIXED_BASIS_WARNING =
  "Combined figure: Google counts All conversions including view-through, Meta counts on its own attribution setting.";

type VolumeKey = "purchases" | "registrations" | "allConversions";

interface CardDefinition {
  key: string;
  stage: JourneyStage;
  label: string;
  unit: MetricCardData["unit"];
  favorableDirection: MetricCardData["favorableDirection"];
  evidenceKey: string;
  read: (totals: MetricTotals) => number | null;
  /** Only reported by this platform, so it hides on the other one. */
  platformScope?: Exclude<Platform, "all">;
  /**
   * Whether the underlying quantity was measured at all. Omitted for metrics
   * every source always reports, where a null `read` can only mean a division
   * that had no denominator. Defined for metrics whose availability depends on
   * account configuration, so the card can separate "nothing to divide by"
   * from "never tracked here".
   */
  measured?: (totals: MetricTotals) => boolean;
  /** Conversion count this metric depends on, for the volume read. */
  volumeKey?: VolumeKey;
}

const CARD_DEFINITIONS: CardDefinition[] = [
  {
    key: "spend",
    stage: "investment",
    label: "Spend",
    unit: "currency",
    favorableDirection: "neutral",
    evidenceKey: "spend",
    read: (totals) => totals.spend,
  },
  {
    key: "impressions",
    stage: "reach",
    label: "Impressions",
    unit: "count",
    favorableDirection: "higher",
    evidenceKey: "impressions",
    read: (totals) => totals.impressions,
  },
  {
    key: "cpm",
    stage: "reach",
    label: "CPM",
    unit: "currency",
    favorableDirection: "lower",
    evidenceKey: "cpm",
    read: (totals) => totals.cpm,
  },
  {
    key: "averageDailyReach",
    stage: "reach",
    label: "Reach per day",
    unit: "count",
    favorableDirection: "higher",
    evidenceKey: "average_daily_reach",
    read: (totals) => totals.averageDailyReach,
    platformScope: "meta",
  },
  {
    key: "averageDailyFrequency",
    stage: "reach",
    label: "Frequency per day",
    unit: "ratio",
    favorableDirection: "lower",
    evidenceKey: "average_daily_frequency",
    read: (totals) => totals.averageDailyFrequency,
    platformScope: "meta",
  },
  // Impression share and its two lost buckets are deliberately absent: they
  // have their own section with the per-campaign breakdown, and repeating them
  // here made the same number argue with itself in two places.
  {
    key: "clicks",
    stage: "engagement",
    label: "Clicks",
    unit: "count",
    favorableDirection: "higher",
    evidenceKey: "clicks",
    read: (totals) => totals.clicks,
  },
  {
    key: "ctr",
    stage: "engagement",
    label: "CTR",
    unit: "percent",
    favorableDirection: "higher",
    evidenceKey: "ctr",
    read: (totals) => totals.ctr,
  },
  {
    key: "cpc",
    stage: "engagement",
    label: "CPC",
    unit: "currency",
    favorableDirection: "lower",
    evidenceKey: "cpc",
    read: (totals) => totals.cpc,
  },
  {
    key: "landingPageViews",
    stage: "consideration",
    label: "Page views",
    unit: "count",
    favorableDirection: "higher",
    evidenceKey: "landing_page_views",
    read: (totals) => totals.landingPageViews,
    measured: (totals) => totals.landingPageViews !== null,
  },
  {
    key: "clickToLpvRate",
    stage: "consideration",
    label: "Click → page view",
    unit: "percent",
    favorableDirection: "higher",
    evidenceKey: "click_to_lpv_rate",
    read: (totals) => totals.clickToLpvRate,
    measured: (totals) => totals.landingPageViews !== null,
  },
  {
    key: "costPerLandingPageView",
    stage: "consideration",
    label: "Cost per page view",
    unit: "currency",
    favorableDirection: "lower",
    evidenceKey: "cost_per_landing_page_view",
    read: (totals) => totals.costPerLandingPageView,
    measured: (totals) => totals.landingPageViews !== null,
  },
  {
    key: "engagedVisits",
    stage: "consideration",
    label: "Engaged visits",
    unit: "count",
    favorableDirection: "higher",
    evidenceKey: "engaged_visits",
    read: (totals) => totals.engagedVisits,
    measured: (totals) => totals.engagedVisits !== null,
  },
  {
    key: "addToBaskets",
    stage: "consideration",
    label: "Add to basket",
    unit: "count",
    favorableDirection: "higher",
    evidenceKey: "add_to_baskets",
    read: (totals) => totals.addToBaskets,
    measured: (totals) => totals.addToBaskets !== null,
  },
  {
    key: "lpvToBasketRate",
    stage: "consideration",
    label: "Page view → basket",
    unit: "percent",
    favorableDirection: "higher",
    evidenceKey: "lpv_to_basket_rate",
    read: (totals) => totals.lpvToBasketRate,
    measured: (totals) =>
      totals.landingPageViews !== null && totals.addToBaskets !== null,
  },
  {
    key: "costPerAddToBasket",
    stage: "consideration",
    label: "Cost per basket",
    unit: "currency",
    favorableDirection: "lower",
    evidenceKey: "cost_per_add_to_basket",
    read: (totals) => totals.costPerAddToBasket,
    measured: (totals) => totals.addToBaskets !== null,
  },
  {
    key: "registrations",
    stage: "acquisition",
    label: "Registrations",
    unit: "count",
    favorableDirection: "higher",
    evidenceKey: "registrations",
    read: (totals) => totals.registrations,
    volumeKey: "registrations",
  },
  {
    key: "costPerRegistration",
    stage: "acquisition",
    label: "CPA · cost per acquisition",
    unit: "currency",
    favorableDirection: "lower",
    evidenceKey: "cost_per_registration",
    read: (totals) => totals.costPerRegistration,
    volumeKey: "registrations",
  },
  {
    key: "lpvToRegistrationRate",
    stage: "acquisition",
    label: "Landing view → registration",
    unit: "percent",
    favorableDirection: "higher",
    evidenceKey: "lpv_to_registration_rate",
    read: (totals) => totals.lpvToRegistrationRate,
    volumeKey: "registrations",
  },
  {
    key: "allConversionRate",
    stage: "acquisition",
    label: "All conversion rate",
    unit: "percent",
    favorableDirection: "higher",
    evidenceKey: "all_conversion_rate",
    read: (totals) => totals.allConversionRate,
    volumeKey: "allConversions",
  },
  {
    key: "purchases",
    stage: "acquisition",
    label: "Purchases",
    unit: "count",
    favorableDirection: "higher",
    evidenceKey: "purchases",
    read: (totals) => totals.purchases,
    volumeKey: "purchases",
  },
  {
    key: "costPerPurchase",
    stage: "acquisition",
    label: "CPO · cost per order",
    unit: "currency",
    favorableDirection: "lower",
    evidenceKey: "cost_per_purchase",
    read: (totals) => totals.costPerPurchase,
    volumeKey: "purchases",
  },
  {
    key: "registrationToPurchaseRate",
    stage: "acquisition",
    label: "Registration → purchase",
    unit: "percent",
    favorableDirection: "higher",
    evidenceKey: "registration_to_purchase_rate",
    read: (totals) => totals.registrationToPurchaseRate,
    volumeKey: "purchases",
  },
  {
    key: "actualPurchaseRevenue",
    stage: "revenue",
    label: "Actual purchase revenue",
    unit: "currency",
    favorableDirection: "higher",
    evidenceKey: "actual_purchase_revenue",
    read: (totals) => totals.actualPurchaseRevenue,
    volumeKey: "purchases",
  },
  {
    key: "averageOrderValue",
    stage: "revenue",
    label: "Average order value",
    unit: "currency",
    favorableDirection: "higher",
    evidenceKey: "average_order_value",
    read: (totals) => totals.averageOrderValue,
    volumeKey: "purchases",
  },
  {
    key: "actualRevenueRoas",
    stage: "revenue",
    label: "Store ROAS",
    unit: "ratio",
    favorableDirection: "higher",
    evidenceKey: "actual_revenue_roas",
    read: (totals) => totals.actualRevenueRoas,
    volumeKey: "purchases",
  },
  {
    key: "platformValueRatio",
    stage: "revenue",
    label: "Platform value ÷ actual",
    unit: "ratio",
    favorableDirection: "lower",
    evidenceKey: "platform_value_ratio",
    read: (totals) => totals.platformValueRatio,
    volumeKey: "purchases",
  },
];

/**
 * Metrics that can be plotted as a daily Customer Journey trend.
 *
 * Keep this list derived from the same card definitions used by the journey
 * rail so labels, units, platform availability, and favorable direction do
 * not drift between the scorecard and Delivery Trend. Spend remains the
 * investment baseline; the remaining keys follow the product owner's requested
 * Reach -> Engagement -> Consideration -> Acquisition -> Revenue sequence.
 */
export const JOURNEY_TREND_METRIC_KEYS = [
  "spend",
  "impressions",
  "cpm",
  "averageDailyReach",
  "clicks",
  "ctr",
  "cpc",
  "landingPageViews",
  "costPerLandingPageView",
  "clickToLpvRate",
  "engagedVisits",
  "addToBaskets",
  "costPerAddToBasket",
  "registrations",
  "costPerRegistration",
  "purchases",
  "costPerPurchase",
  "allConversionRate",
  "actualPurchaseRevenue",
  "averageOrderValue",
  "actualRevenueRoas",
] as const;

export type JourneyTrendMetricKey =
  (typeof JOURNEY_TREND_METRIC_KEYS)[number];

export interface JourneyTrendMetricDefinition {
  key: JourneyTrendMetricKey;
  stage: JourneyStage;
  label: string;
  unit: MetricCardData["unit"];
  favorableDirection: MetricCardData["favorableDirection"];
  platformScope: Exclude<Platform, "all"> | null;
  read: (totals: MetricTotals) => number | null;
}

const JOURNEY_TREND_LABELS: Partial<
  Record<JourneyTrendMetricKey, string>
> = {
  clickToLpvRate: "Page view rate",
  allConversionRate: "Conversion rate",
  actualPurchaseRevenue: "Revenue",
  actualRevenueRoas: "ROAS",
};

export const JOURNEY_TREND_METRICS: JourneyTrendMetricDefinition[] =
  JOURNEY_TREND_METRIC_KEYS.map((key) => {
    const definition = CARD_DEFINITIONS.find((item) => item.key === key);
    if (!definition) {
      throw new Error(`Missing Customer Journey card definition for ${key}`);
    }

    return {
      key,
      stage: definition.stage,
      label: JOURNEY_TREND_LABELS[key] ?? definition.label,
      unit: definition.unit,
      favorableDirection: definition.favorableDirection,
      platformScope: definition.platformScope ?? null,
      read: definition.read,
    };
  });

function volumeCountFor(
  totals: MetricTotals,
  volumeKey: VolumeKey | undefined,
): number | null {
  if (volumeKey === "purchases") return totals.purchases;
  if (volumeKey === "registrations") return totals.registrations;
  if (volumeKey === "allConversions") return totals.allConversions;
  return null;
}

export function buildJourneyCards(
  totals: MetricTotals,
  comparisonTotals: MetricTotals,
  sourceQueryVersion: string,
  platform: Platform,
  /** Days in the selected period, so a low-volume card can say how far to widen. */
  periodDays?: number,
): MetricCardData[] {
  return CARD_DEFINITIONS.filter(
    (definition) =>
      definition.platformScope === undefined ||
      platform === "all" ||
      definition.platformScope === platform,
  ).map((definition) => {
    const count = volumeCountFor(totals, definition.volumeKey);
    const verdict = count === null ? null : volumeVerdict(count, periodDays);

    return {
      key: definition.key,
      stage: definition.stage,
      label:
        definition.key === "purchases" && platform === "all"
          ? "Platform-attributed purchases"
          : definition.label,
      value: definition.read(totals),
      previousValue: definition.read(comparisonTotals),
      unit: definition.unit,
      favorableDirection: definition.favorableDirection,
      evidenceId: `metric:${definition.evidenceKey}:${sourceQueryVersion}`,
      platformScope: definition.platformScope ?? null,
      // Availability is read from the current period only. The comparison
      // period is a separate scope and may well have been measured when this
      // one was not; reporting the two as one state would hide exactly the
      // moment tracking broke.
      availability:
        definition.measured === undefined || definition.measured(totals)
          ? ("reported" as const)
          : ("not-reported" as const),
      // A conversion metric read across both platforms mixes two counting
      // bases, so the card carries that warning itself.
      mixedBasisWarning:
        platform === "all" && definition.volumeKey !== undefined
          ? MIXED_BASIS_WARNING
          : null,
      confidence: verdict?.confidence ?? null,
      confidenceMessage: verdict?.safeMessage ?? null,
    };
  });
}

export function groupCardsByStage(
  cards: readonly MetricCardData[],
): { definition: JourneyStageDefinition; cards: MetricCardData[] }[] {
  return JOURNEY_STAGES.map((definition) => ({
    definition,
    cards: cards.filter((card) => card.stage === definition.stage),
  })).filter((group) => group.cards.length > 0);
}
