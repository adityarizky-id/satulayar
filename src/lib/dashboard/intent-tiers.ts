import type {
  Currency,
  GoogleIntentAnalysis,
  GoogleIntentTierRow,
  GoogleMatchTypeDriftSummary,
  GoogleNegativeRecommendation,
  GoogleWastedSpendSummary,
  IntentTierKey,
  WasteCoverage,
} from "@/lib/dashboard/types";
import {
  classifySearchIntent,
  DEFAULT_INTENT_PROFILE,
  type IntentProfile,
} from "@/lib/analytics/intent-classifier";
import { analyzeWastedSpend } from "@/lib/analytics/wasted-spend-analyzer";
import type { StoredSearchTermRow } from "@/lib/dashboard/search-terms";

/**
 * The non-brand intent ladder and its two companion panels.
 *
 * Three rules hold across every builder here:
 *
 * 1. Brand queries never enter the ladder. The ladder's whole claim is about
 *    non-brand demand, and brand spend inside the denominator flatters it.
 * 2. A query no rule matched is reported as unclassified, not as the tier the
 *    classifier falls back to.
 * 3. A conversion that was not measured stays null. It is never added as zero,
 *    because zero orders and no measurement lead to opposite decisions.
 */

const TIER_META: Record<IntentTierKey, { label: string; description: string }> = {
  high_intent_category: {
    label: "Tier 1: Category & Bulk Buying",
    description: "Ready-to-buy wholesale, bulk supply, and trade order queries",
  },
  problem_aware: {
    label: "Tier 2: Problem-Aware & Discovery",
    description: "Starting a business, production guidance, and packaging research",
  },
  unclassified_waste: {
    label: "Tier 3: Irrelevant Waste & Drift",
    description: "Retail single-piece, DIY hobby, free recipes, and low-intent queries",
  },
  unclassified: {
    label: "Not classified",
    description: "No wording rule matched these queries, so no tier was assigned",
  },
};

const LADDER_ORDER: readonly IntentTierKey[] = [
  "high_intent_category",
  "problem_aware",
  "unclassified_waste",
  "unclassified",
];

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function emptyIntentAnalysis(note: string): GoogleIntentAnalysis {
  return {
    tiers: [],
    highIntentSharePercent: null,
    classifiedSharePercent: 0,
    brandSpend: 0,
    brandSharePercent: 0,
    queryCount: 0,
    strategicNote: note,
  };
}

/**
 * Builds the Google Search Intent Tier breakdown (Non-Brand Intent Ladder).
 *
 * Mock shape only: the figures are scaled from account spend, and the panel
 * carries the synthetic-illustration notice that says so.
 */
export function buildGoogleIntentAnalysis(input: {
  googleSpend: number;
  googleClicks: number;
  googlePurchases: number;
  currency: Currency;
}): GoogleIntentAnalysis {
  const { googleSpend, googleClicks, googlePurchases } = input;

  if (googleSpend <= 0) {
    return emptyIntentAnalysis(
      "No active Google Search spend recorded in this period.",
    );
  }

  const brandSpend = Math.round(googleSpend * 0.16);
  const nonBrandSpend = googleSpend - brandSpend;
  const nonBrandClicks = Math.round(googleClicks * 0.84);
  const nonBrandPurchases = Math.round(googlePurchases * 0.82);

  const shape: Record<
    Exclude<IntentTierKey, "unclassified">,
    { spend: number; clicks: number; purchases: number; value: number; queries: string[] }
  > = {
    high_intent_category: {
      spend: Math.round(nonBrandSpend * 0.7),
      clicks: Math.round(nonBrandClicks * 0.66),
      purchases: Math.round(nonBrandPurchases * 0.84),
      value: Math.round(nonBrandSpend * 0.7 * 4.8),
      queries: [
        "wholesale coffee supplies id",
        "bulk arabica coffee bottles trade",
        "drip bag filter wholesale 5l",
        "green coffee beans wholesale bulk",
      ],
    },
    problem_aware: {
      spend: Math.round(nonBrandSpend * 0.19),
      clicks: Math.round(nonBrandClicks * 0.23),
      purchases: Math.round(nonBrandPurchases * 0.16),
      value: Math.round(nonBrandSpend * 0.19 * 2.1),
      queries: [
        "how to start coffee brand supplies",
        "best flavour notes arabica coffee blends",
        "eco friendly coffee packaging wholesale",
      ],
    },
    unclassified_waste: {
      spend: Math.round(nonBrandSpend * 0.11),
      clicks: Math.round(nonBrandClicks * 0.11),
      purchases: 0,
      value: 0,
      queries: [
        "free coffee flavour recipes pdf",
        "cheap arabica coffee single sachet amazon",
        "coffee making jobs vacancy",
        "diy jamu for school project",
      ],
    },
  };

  const tiers: GoogleIntentTierRow[] = LADDER_ORDER.map((tier) => {
    if (tier === "unclassified") {
      return {
        tier,
        label: TIER_META[tier].label,
        description: TIER_META[tier].description,
        spend: 0,
        spendSharePercent: 0,
        clicks: 0,
        cpc: null,
        purchases: 0,
        cpa: null,
        roas: null,
        topSampleQueries: [],
      };
    }

    const bucket = shape[tier];
    return {
      tier,
      label: TIER_META[tier].label,
      description: TIER_META[tier].description,
      spend: bucket.spend,
      spendSharePercent:
        nonBrandSpend > 0 ? Math.round((bucket.spend / nonBrandSpend) * 100) : 0,
      clicks: bucket.clicks,
      cpc: bucket.clicks > 0 ? round2(bucket.spend / bucket.clicks) : null,
      purchases: bucket.purchases,
      cpa: bucket.purchases > 0 ? Math.round(bucket.spend / bucket.purchases) : null,
      roas: bucket.spend > 0 ? round2(bucket.value / bucket.spend) : null,
      topSampleQueries: bucket.queries,
    };
  });

  const highIntentSharePercent = tiers[0].spendSharePercent;

  return {
    tiers,
    highIntentSharePercent,
    classifiedSharePercent: 100,
    brandSpend,
    brandSharePercent: Math.round((brandSpend / googleSpend) * 100),
    queryCount: 0,
    strategicNote: `${highIntentSharePercent}% of non-brand search spend sits on the top rung; brand is held out of the ladder at ${Math.round((brandSpend / googleSpend) * 100)}% of Search spend.`,
  };
}

/**
 * Builds the Wasted Spend Dollar Impact and Negative Keyword recommendation list.
 *
 * Mock shape only.
 */
export function buildGoogleWastedSpendSummary(input: {
  googleSpend: number;
  currency: Currency;
  daysInRange?: number;
}): GoogleWastedSpendSummary {
  const { googleSpend } = input;
  const days = input.daysInRange ?? 14;

  if (googleSpend <= 0) {
    return {
      totalWastedAmount: 0,
      wastedSpendPercent: 0,
      monthlyProjectedSavings: 0,
      flaggedQueryCount: 0,
      spendAnalyzed: 0,
      measuredSpend: 0,
      unmeasuredConversionSpend: 0,
      coverage: "none",
      recommendations: [],
    };
  }

  const recommendations: GoogleNegativeRecommendation[] = [
    {
      query: "free coffee flavour recipes pdf",
      reason: "Research / Free intent (0 commercial value)",
      spendWasted: Math.round(googleSpend * 0.024),
      clicks: 18,
      suggestedExact: "[free coffee flavour recipes pdf]",
      suggestedPhrase: "\"free\"",
    },
    {
      query: "cheap arabica coffee single sachet amazon",
      reason: "Single-unit bargain intent",
      spendWasted: Math.round(googleSpend * 0.020),
      clicks: 14,
      suggestedExact: "[cheap arabica coffee single sachet amazon]",
      suggestedPhrase: "\"single sachet\"",
    },
    {
      query: "coffee making jobs vacancy",
      reason: "Employment / Career intent",
      spendWasted: Math.round(googleSpend * 0.018),
      clicks: 12,
      suggestedExact: "[coffee making jobs vacancy]",
      suggestedPhrase: "\"jobs\"",
    },
    {
      query: "diy jamu for school project tutorial",
      reason: "Hobbyist / School project intent",
      spendWasted: Math.round(googleSpend * 0.018),
      clicks: 15,
      suggestedExact: "[diy jamu for school project tutorial]",
      suggestedPhrase: "\"tutorial\"",
    },
  ];

  const totalWastedAmount = recommendations.reduce((sum, r) => sum + r.spendWasted, 0);
  const wastedSpendPercent = Number(((totalWastedAmount / googleSpend) * 100).toFixed(1));
  const monthlyProjectedSavings = Math.round((totalWastedAmount / Math.max(1, days)) * 30);

  return {
    totalWastedAmount,
    wastedSpendPercent,
    monthlyProjectedSavings,
    flaggedQueryCount: recommendations.length,
    spendAnalyzed: googleSpend,
    measuredSpend: googleSpend,
    unmeasuredConversionSpend: 0,
    coverage: "complete",
    recommendations,
  };
}

/**
 * Builds the Match-Type Quality and Broad Query Drift monitor.
 *
 * Mock shape only.
 */
export function buildGoogleMatchTypeDriftSummary(input: {
  googleSpend: number;
}): GoogleMatchTypeDriftSummary {
  const { googleSpend } = input;

  if (googleSpend <= 0) {
    return {
      exactSpend: 0,
      exactSharePercent: 0,
      phraseSpend: 0,
      phraseSharePercent: 0,
      broadSpend: 0,
      broadSharePercent: 0,
      driftIndexPercent: null,
      driftVerdict: "insufficient_data",
      driftNote: "No active Google Search match-type data.",
    };
  }

  const exactSpend = Math.round(googleSpend * 0.44);
  const phraseSpend = Math.round(googleSpend * 0.42);
  const broadSpend = Math.round(googleSpend * 0.14);

  return {
    exactSpend,
    exactSharePercent: 44,
    phraseSpend,
    phraseSharePercent: 42,
    broadSpend,
    broadSharePercent: 14,
    driftIndexPercent: 12.5,
    driftVerdict: "tight",
    driftNote:
      "Exact (44%) and Phrase (42%) form the core of account delivery. Broad match is controlled at 14% with a low drift rate (12.5%).",
  };
}

interface LiveTierBucket {
  spend: number;
  clicks: number;
  purchases: number;
  purchaseValue: number;
  /** False as soon as one row in the bucket had no conversion measurement. */
  purchasesMeasured: boolean;
  /** False as soon as one row in the bucket had no conversion value. */
  valueMeasured: boolean;
  queries: { query: string; spend: number }[];
}

function emptyBucket(): LiveTierBucket {
  return {
    spend: 0,
    clicks: 0,
    purchases: 0,
    purchaseValue: 0,
    purchasesMeasured: true,
    valueMeasured: true,
    queries: [],
  };
}

function addRow(bucket: LiveTierBucket, row: StoredSearchTermRow): void {
  bucket.spend += row.spend;
  bucket.clicks += row.clicks;
  if (row.purchases === null) bucket.purchasesMeasured = false;
  else bucket.purchases += row.purchases;
  if (row.purchaseValue === null) bucket.valueMeasured = false;
  else bucket.purchaseValue += row.purchaseValue;
  bucket.queries.push({ query: row.searchTerm, spend: row.spend });
}

/**
 * Builds live Google Search Intent Tier breakdown from stored search term rows.
 */
export function buildGoogleIntentAnalysisFromRows(input: {
  rows: readonly StoredSearchTermRow[];
  currency: Currency;
  /** Brand aliases and market lexicon for the account being read. */
  profile?: IntentProfile;
}): GoogleIntentAnalysis {
  const { rows } = input;
  const profile = input.profile ?? DEFAULT_INTENT_PROFILE;

  if (rows.length === 0) {
    return emptyIntentAnalysis("No search query rows recorded in this period.");
  }

  const buckets: Record<IntentTierKey, LiveTierBucket> = {
    high_intent_category: emptyBucket(),
    problem_aware: emptyBucket(),
    unclassified_waste: emptyBucket(),
    unclassified: emptyBucket(),
  };
  const brand = emptyBucket();
  const distinctQueries = new Set<string>();

  let totalSpend = 0;
  let nonBrandSpend = 0;
  let classifiedSpend = 0;

  for (const row of rows) {
    const classification = classifySearchIntent(row.searchTerm, profile);
    totalSpend += row.spend;

    // Brand is held out of the ladder entirely, not given a rung on it.
    if (classification.classified && classification.tier === "brand_intent") {
      addRow(brand, row);
      continue;
    }

    let key: IntentTierKey;
    if (!classification.classified) {
      key = "unclassified";
    } else if (classification.tier === "high_commercial") {
      key = "high_intent_category";
    } else if (classification.tier === "informational_consideration") {
      key = "problem_aware";
    } else {
      key = "unclassified_waste";
    }

    addRow(buckets[key], row);
    nonBrandSpend += row.spend;
    if (classification.classified) classifiedSpend += row.spend;
    distinctQueries.add(classification.normalizedQuery);
  }

  const tiers: GoogleIntentTierRow[] = LADDER_ORDER.map((tier) => {
    const bucket = buckets[tier];
    const purchases = bucket.purchasesMeasured ? bucket.purchases : null;

    return {
      tier,
      label: TIER_META[tier].label,
      description: TIER_META[tier].description,
      spend: round2(bucket.spend),
      spendSharePercent:
        nonBrandSpend > 0 ? Math.round((bucket.spend / nonBrandSpend) * 100) : 0,
      clicks: bucket.clicks,
      cpc: bucket.clicks > 0 ? round2(bucket.spend / bucket.clicks) : null,
      purchases,
      cpa:
        purchases !== null && purchases > 0
          ? Math.round(bucket.spend / purchases)
          : null,
      // Return needs both a measured value and spend to divide it by. Without
      // the value feed this stays null and the panel says "not measured"
      // rather than painting every tier as a zero-return tier.
      roas:
        bucket.valueMeasured && bucket.spend > 0
          ? round2(bucket.purchaseValue / bucket.spend)
          : null,
      topSampleQueries: bucket.queries
        .toSorted((a, b) => b.spend - a.spend)
        .slice(0, 4)
        .map((q) => q.query),
    };
  });

  const highIntentSharePercent =
    nonBrandSpend > 0 ? tiers[0].spendSharePercent : null;
  const classifiedSharePercent =
    nonBrandSpend > 0 ? Math.round((classifiedSpend / nonBrandSpend) * 100) : 0;
  const brandSharePercent =
    totalSpend > 0 ? Math.round((brand.spend / totalSpend) * 100) : 0;

  const strategicNote =
    highIntentSharePercent === null
      ? "Every query read in this period was a brand query, so the non-brand ladder has nothing to rank."
      : classifiedSharePercent < 50
        ? `Only ${classifiedSharePercent}% of non-brand spend matched a wording rule, so the ladder below describes a minority of the account. Read it as a sample, not as the shape of demand.`
        : `${highIntentSharePercent}% of classified non-brand search spend is in high-intent commercial queries.`;

  return {
    tiers,
    highIntentSharePercent,
    classifiedSharePercent,
    brandSpend: round2(brand.spend),
    brandSharePercent,
    queryCount: distinctQueries.size,
    strategicNote,
  };
}

function resolveCoverage(
  spendAnalyzed: number,
  measuredSpend: number,
): WasteCoverage {
  if (spendAnalyzed <= 0 || measuredSpend <= 0) return "none";
  // A tenth of the spend left unmeasured is enough to change a verdict, so the
  // threshold sits close to complete rather than at a comfortable majority.
  return measuredSpend / spendAnalyzed >= 0.99 ? "complete" : "partial";
}

/**
 * Builds live Google Wasted Spend Summary from stored search term rows.
 */
export function buildGoogleWastedSpendSummaryFromRows(input: {
  rows: readonly StoredSearchTermRow[];
  currency: Currency;
  targetCostPerAcquisition: number;
  daysInRange?: number;
}): GoogleWastedSpendSummary {
  const { rows, targetCostPerAcquisition, daysInRange } = input;
  const analysis = analyzeWastedSpend(rows, {
    targetCostPerAcquisition,
    daysInRange,
  });

  return {
    totalWastedAmount: analysis.totalWastedAmount,
    wastedSpendPercent: analysis.wastedSpendPercent,
    monthlyProjectedSavings: analysis.monthlyProjectedSavings,
    flaggedQueryCount: analysis.flaggedQueryCount,
    spendAnalyzed: analysis.spendAnalyzed,
    measuredSpend: analysis.measuredSpend,
    unmeasuredConversionSpend: analysis.unmeasuredConversionSpend,
    coverage: resolveCoverage(analysis.spendAnalyzed, analysis.measuredSpend),
    recommendations: analysis.recommendations.map((r) => ({
      query: r.query,
      reason: r.reason,
      spendWasted: r.spendWasted,
      clicks: r.clicks,
      suggestedExact: r.suggestedExact ?? `[${r.query}]`,
      suggestedPhrase: r.suggestedPhrase ?? `"${r.query}"`,
    })),
  };
}

/**
 * Builds live Google Match Type Drift Summary from stored search term rows.
 */
export function buildGoogleMatchTypeDriftSummaryFromRows(input: {
  rows: readonly StoredSearchTermRow[];
  targetCostPerAcquisition: number;
}): GoogleMatchTypeDriftSummary {
  const { rows, targetCostPerAcquisition } = input;
  const analysis = analyzeWastedSpend(rows, { targetCostPerAcquisition });
  const drift = analysis.matchTypeDrift;

  let exactSpend = 0;
  let phraseSpend = 0;
  let broadSpend = 0;
  for (const row of rows) {
    const mt = row.keywordMatchType?.toLowerCase() ?? "";
    if (mt.includes("exact")) exactSpend += row.spend;
    else if (mt.includes("phrase")) phraseSpend += row.spend;
    else broadSpend += row.spend;
  }
  const total = exactSpend + phraseSpend + broadSpend;
  const exactSharePercent =
    total > 0 ? Math.round((exactSpend / total) * 100) : 0;
  const phraseSharePercent =
    total > 0 ? Math.round((phraseSpend / total) * 100) : 0;
  const broadSharePercent =
    total > 0 ? Math.round((broadSpend / total) * 100) : 0;

  // No scoreable query means no verdict. Scoring that absence as 0% put it
  // below the "tight" boundary and published silence as a clean result.
  const driftIndexPercent = drift.driftIndexPercent;
  const driftVerdict: GoogleMatchTypeDriftSummary["driftVerdict"] =
    driftIndexPercent === null
      ? "insufficient_data"
      : driftIndexPercent < 35
        ? "tight"
        : driftIndexPercent < 55
          ? "moderate_drift"
          : "high_drift";

  return {
    exactSpend: round2(exactSpend),
    exactSharePercent,
    phraseSpend: round2(phraseSpend),
    phraseSharePercent,
    broadSpend: round2(broadSpend),
    broadSharePercent,
    driftIndexPercent,
    driftVerdict,
    driftNote:
      driftIndexPercent === null
        ? `None of the ${rows.length} query rows carried a keyword that could be scored for drift, so no drift verdict is available.`
        : `Drift index is ${driftIndexPercent}% across ${rows.length} analyzed search query rows.`,
  };
}
