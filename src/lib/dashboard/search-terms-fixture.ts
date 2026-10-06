import {
  buildKeywordRows,
  buildNgramGroups,
  judgeRelevance,
  judgeWaste,
  resolveComparisonRange,
  summariseMatchTypes,
  type ComparisonWindow,
  type MatchType,
  type SearchTermAnalysis,
  type SearchTermMetrics,
  type SearchTermRow,
} from "@/lib/dashboard/search-terms";
import type { PerformanceTargets } from "@/lib/dashboard/targets";
import type { Currency, DateRange } from "@/lib/dashboard/types";

interface KeywordSeed {
  keyword: string;
  matchType: MatchType;
  campaignType: string;
  /** Share of search spend this keyword takes. */
  spendShare: number;
  /** Cost per order this keyword tends to deliver; drives its conversions. */
  costPerOrder: number;
  terms: { text: string; weight: number; termMatchType: MatchType }[];
}

/**
 * Synthetic keywords and the queries they matched. The shapes are chosen so the
 * section has something real to find: a broad keyword pulling job-seekers, a
 * phrase keyword pulling DIY intent, and exact keywords that behave.
 */
const KEYWORD_SEEDS: KeywordSeed[] = [
  {
    keyword: "arabica coffee beans",
    matchType: "exact",
    campaignType: "Search · non-brand",
    spendShare: 0.16,
    costPerOrder: 24,
    terms: [
      { text: "arabica coffee beans", weight: 0.6, termMatchType: "exact" },
      { text: "arabica coffee beans id", weight: 0.4, termMatchType: "phrase" },
    ],
  },
  {
    keyword: "wholesale specialty coffee",
    matchType: "phrase",
    campaignType: "Search · non-brand",
    spendShare: 0.14,
    costPerOrder: 27,
    terms: [
      { text: "wholesale specialty coffee", weight: 0.34, termMatchType: "exact" },
      { text: "bulk batik cloth supplier", weight: 0.3, termMatchType: "phrase" },
      { text: "how to make batik cloth", weight: 0.22, termMatchType: "broad" },
      { text: "diy drip bag recipe", weight: 0.14, termMatchType: "broad" },
    ],
  },
  {
    keyword: "rattan supplier",
    matchType: "broad",
    campaignType: "Search · non-brand",
    spendShare: 0.22,
    costPerOrder: 61,
    terms: [
      { text: "rattan supplier id", weight: 0.22, termMatchType: "phrase" },
      { text: "wholesale baskets bulk", weight: 0.2, termMatchType: "phrase" },
      { text: "rattan shop jobs", weight: 0.16, termMatchType: "broad" },
      { text: "rattan weaving meaning", weight: 0.16, termMatchType: "broad" },
      { text: "used baskets ebay", weight: 0.14, termMatchType: "broad" },
      { text: "single rattan coaster for personal use", weight: 0.12, termMatchType: "broad" },
    ],
  },
  {
    keyword: "coffee supplier near me",
    matchType: "broad",
    campaignType: "Search · non-brand",
    spendShare: 0.18,
    costPerOrder: 48,
    terms: [
      { text: "coffee supplier near me", weight: 0.28, termMatchType: "exact" },
      { text: "cafe coffee bean supplier", weight: 0.24, termMatchType: "phrase" },
      { text: "barista jobs near me", weight: 0.2, termMatchType: "broad" },
      { text: "how to open a coffee shop", weight: 0.16, termMatchType: "broad" },
      { text: "barista salary id", weight: 0.12, termMatchType: "broad" },
    ],
  },
  {
    keyword: "rumah nusantara",
    matchType: "exact",
    campaignType: "Search · brand",
    spendShare: 0.12,
    costPerOrder: 9,
    terms: [
      { text: "rumah nusantara", weight: 0.7, termMatchType: "exact" },
      { text: "rumah nusantara store", weight: 0.3, termMatchType: "phrase" },
    ],
  },
  {
    keyword: "bulk beans",
    matchType: "phrase",
    campaignType: "Search · non-brand",
    spendShare: 0.18,
    costPerOrder: 33,
    terms: [
      { text: "bulk beans wholesale", weight: 0.4, termMatchType: "phrase" },
      { text: "coffee supplies bulk", weight: 0.3, termMatchType: "phrase" },
      { text: "homemade coffee tutorial", weight: 0.18, termMatchType: "broad" },
      { text: "coffee making jobs", weight: 0.12, termMatchType: "broad" },
    ],
  },
];

function hash(value: string): number {
  let result = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16_777_619);
  }
  return (result >>> 0) / 4_294_967_296;
}

function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function daysIn(range: DateRange): number {
  const start = Date.parse(`${range.start}T00:00:00Z`);
  const end = Date.parse(`${range.end}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 1;
  return Math.floor((end - start) / 86_400_000) + 1;
}

const BASELINE_DAYS = 14;

function metricsFor(
  seed: KeywordSeed,
  term: { text: string; weight: number },
  range: DateRange,
  searchSpend: number,
  accountSlug: string,
): SearchTermMetrics {
  const scale = daysIn(range) / BASELINE_DAYS;
  const noise = 0.85 + hash(`${accountSlug}|${term.text}|${range.start}`) * 0.3;
  const spend = round(searchSpend * seed.spendShare * term.weight * scale * noise);

  // A query whose wording points the wrong way converts far worse than the
  // keyword's own average — that is what makes it findable here.
  const relevance = judgeRelevance(term.text, {
    spend,
    impressions: 0,
    clicks: 0,
    registrations: 0,
    purchases: 0,
    purchaseValue: 0,
  }, { costPerOrder: 30, costPerAcquisition: 30, conversionRate: 0.05 });
  const penalty = relevance.verdict === "irrelevant" ? 12 : 1;
  const effectiveCostPerOrder = seed.costPerOrder * penalty;

  // Rounding, not flooring: a term spending just under one order's worth still
  // has to be able to produce that order, or every keyword reads "nothing back"
  // and the waste signal stops meaning anything.
  const purchases = Math.round(spend / effectiveCostPerOrder);
  const registrations =
    relevance.verdict === "irrelevant"
      ? Math.floor(spend / (effectiveCostPerOrder / 1.4))
      : Math.round(purchases * (2.4 + hash(`${term.text}|regs`) * 1.8));
  const costPerClick = 0.35 + hash(`${term.text}|cpc`) * 0.55;
  const clicks = Math.max(0, Math.round(spend / costPerClick));
  const impressions = Math.max(
    clicks,
    Math.round(clicks / (0.02 + hash(`${term.text}|ctr`) * 0.05)),
  );
  const averageOrderValue = 42 + hash(`${term.text}|aov`) * 28;

  return {
    spend,
    impressions,
    clicks,
    registrations,
    purchases,
    purchaseValue: round(purchases * averageOrderValue),
  };
}

export interface SearchTermInput {
  range: DateRange;
  currency: Currency;
  accountSlug: string;
  /** Spend on Search campaigns; the terms partition it. */
  searchSpend: number;
  targets: PerformanceTargets;
  comparisonWindow?: ComparisonWindow;
  /** Explicit baseline dates; only used when the window is "custom". */
  comparisonRange?: DateRange;
}

export function buildSearchTermAnalysis(
  input: SearchTermInput,
): SearchTermAnalysis {
  const window = input.comparisonWindow ?? "previous";
  const comparisonRange = resolveComparisonRange(
    input.range,
    window,
    input.comparisonRange,
  );

  const rows: SearchTermRow[] = KEYWORD_SEEDS.flatMap((seed) =>
    seed.terms.map((term) => {
      const current = metricsFor(
        seed,
        term,
        input.range,
        input.searchSpend,
        input.accountSlug,
      );
      const previous = metricsFor(
        seed,
        term,
        comparisonRange,
        input.searchSpend,
        input.accountSlug,
      );
      const comparisonScale = daysIn(input.range) / daysIn(comparisonRange);
      const comparablePrevious: SearchTermMetrics =
        comparisonScale === 1
          ? previous
          : {
              spend: previous.spend * comparisonScale,
              impressions: previous.impressions * comparisonScale,
              clicks: previous.clicks * comparisonScale,
              registrations: previous.registrations * comparisonScale,
              purchases: previous.purchases * comparisonScale,
              purchaseValue: previous.purchaseValue * comparisonScale,
            };
      const relevance = judgeRelevance(term.text, current, input.targets);

      return {
        id: `${seed.keyword}|${term.text}`,
        term: term.text,
        keyword: seed.keyword,
        keywordMatchType: seed.matchType,
        termMatchType: term.termMatchType,
        campaignType: seed.campaignType,
        // Generated rows are fully "measured" by construction.
        conversionsMeasured: true,
        ...current,
        ctr: current.impressions === 0 ? null : current.clicks / current.impressions,
        cpc: current.clicks === 0 ? null : current.spend / current.clicks,
        costPerPurchase:
          current.purchases === 0 ? null : current.spend / current.purchases,
        costPerRegistration:
          current.registrations === 0
            ? null
            : current.spend / current.registrations,
        returnOnAdSpend:
          current.spend === 0 ? null : current.purchaseValue / current.spend,
        previous: comparablePrevious,
        relevance,
        waste: judgeWaste(
          current,
          comparablePrevious,
          input.targets,
          input.currency,
        ),
      };
    }),
  ).toSorted((left, right) => right.spend - left.spend);

  const totalSpend = round(rows.reduce((total, row) => total + row.spend, 0));
  const irrelevantSpend = round(
    rows
      .filter((row) => row.relevance.verdict === "irrelevant")
      .reduce((total, row) => total + row.spend, 0),
  );
  // Google withholds queries below its reporting threshold. Showing the gap
  // keeps the reader from treating the visible terms as the whole account.
  const belowThresholdSpend = round(Math.max(input.searchSpend - totalSpend, 0));

  return {
    platform: "google",
    dataOrigin: "synthetic-illustration",
    range: input.range,
    comparisonRange,
    comparisonWindow: window,
    currency: input.currency,
    rows,
    keywords: buildKeywordRows(rows, input.targets, input.currency),
    ngrams: buildNgramGroups(rows),
    matchTypes: summariseMatchTypes(rows),
    totals: {
      spend: totalSpend,
      clicks: rows.reduce((total, row) => total + row.clicks, 0),
      registrations: rows.reduce((total, row) => total + row.registrations, 0),
      purchases: rows.reduce((total, row) => total + row.purchases, 0),
      irrelevantSpend,
      belowThresholdSpend,
    },
    safeMessage:
      totalSpend === 0
        ? "No Search spend in this period, so there are no queries to read."
        : `${Math.round((irrelevantSpend / totalSpend) * 100)}% of the search spend shown sits on queries the rules flagged as the wrong intent. Every flag carries its reason — confirm before adding a negative.`,
  };
}
