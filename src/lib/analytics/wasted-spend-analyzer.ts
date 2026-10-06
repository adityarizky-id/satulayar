import {
  classifySearchIntent,
  normalizeSearchQuery,
  tokenizeNgrams,
  type IntentClassification,
  type IntentTier,
} from "@/lib/analytics/intent-classifier";

export type NormalizedMatchType =
  | "exact"
  | "near_exact"
  | "phrase"
  | "near_phrase"
  | "broad"
  | "ai_max"
  | "unknown";
export type DriftVerdict = "aligned" | "review" | "drifted" | "insufficient_data";

/**
 * Minimum shape accepted from a live search-term reader. This is structurally
 * compatible with `StoredSearchTermRow`; keeping the analytics layer unaware
 * of the dashboard builder avoids a dependency cycle.
 */
export interface SearchQueryPerformanceInput {
  searchTerm: string;
  keywordText: string;
  keywordMatchType: string;
  searchTermMatchType?: string;
  campaignKey?: string;
  adGroupKey?: string;
  spend: number;
  impressions: number;
  clicks: number;
  registrations: number | null;
  purchases: number | null;
  purchaseValue?: number | null;
}

export interface DriftComponents {
  /** 1 - lexical similarity. */
  lexicalDistance: number;
  targetCoverage: number;
  queryPrecision: number;
  bigramCoverage: number;
  intentMismatch: number;
  matchTypePenalty: number;
}

export interface MatchTypeDriftFinding {
  searchTerm: string;
  keywordText: string;
  keywordMatchType: NormalizedMatchType;
  searchTermMatchType: NormalizedMatchType;
  score: number | null;
  verdict: DriftVerdict;
  components: DriftComponents | null;
  queryIntent: IntentTier;
  keywordIntent: IntentTier | null;
  spend: number;
  reason: string;
}

export interface WastedQueryFinding {
  searchTerm: string;
  keywordText: string;
  campaignKey: string | null;
  adGroupKey: string | null;
  spend: number;
  clicks: number;
  conversions: number;
  threshold: number;
  spendToThresholdRatio: number;
  detectionBasis: "query_threshold" | "ngram_cluster";
  severity: "watch" | "high" | "critical";
  intent: IntentClassification;
  drift: MatchTypeDriftFinding;
}

export interface NegativeKeywordExportRow {
  negativeKeyword: string;
  matchType: "exact" | "phrase";
  campaignKey: string | null;
  adGroupKey: string | null;
  reason: string;
  sourceSpend: number;
  approvalRequired: true;
}

export interface NegativeKeywordRecommendation {
  query: string;
  basis: "query" | "ngram_cluster";
  matchedQueryCount: number;
  suggestedExact: string | null;
  /** A diagnostic candidate only; exact match remains the export default. */
  suggestedPhrase: string | null;
  reason: string;
  spendWasted: number;
  clicks: number;
  approvalRequired: true;
  exportRow: NegativeKeywordExportRow;
}

export interface MatchTypeDriftSummary {
  eligibleSpend: number;
  driftedSpend: number;
  driftedSpendPercent: number;
  /** Spend-weighted mean of row-level drift scores, expressed as 0..100. */
  driftIndexPercent: number | null;
  findings: MatchTypeDriftFinding[];
}

export interface WastedSpendAnalysis {
  spendAnalyzed: number;
  measuredSpend: number;
  unmeasuredConversionSpend: number;
  zeroConversionSpend: number;
  totalWastedAmount: number;
  wastedSpendPercent: number;
  monthlyProjectedSavings: number;
  flaggedQueryCount: number;
  findings: WastedQueryFinding[];
  recommendations: NegativeKeywordRecommendation[];
  negativeKeywordExportRows: NegativeKeywordExportRow[];
  matchTypeDrift: MatchTypeDriftSummary;
}

export interface WastedSpendAnalyzerOptions {
  /** Native-currency CPA/CPO guardrail. Must be greater than zero. */
  targetCostPerAcquisition: number;
  /** Defaults to one target CPA/CPO. */
  minimumSpendMultiplier?: number;
  /** Used only for the normalized 30-day savings projection. */
  daysInRange?: number;
  driftReviewThreshold?: number;
  driftThreshold?: number;
}

interface AggregatedQuery extends SearchQueryPerformanceInput {
  conversionMeasurementComplete: boolean;
  purchaseValue: number | null;
  campaignKey: string;
  adGroupKey: string;
}

const DRIFT_WEIGHTS = {
  lexicalDistance: 0.6,
  intentMismatch: 0.25,
  matchTypePenalty: 0.15,
} as const;

function round(value: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function assertNonNegativeFinite(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${field} must be a finite number greater than or equal to zero.`);
  }
}

export function normalizeMatchType(value: string): NormalizedMatchType {
  const normalized = value.trim().toLowerCase().replace(/[_-]+/g, " ");
  if (normalized.includes("ai max")) return "ai_max";
  if (normalized.includes("near exact")) return "near_exact";
  if (normalized.includes("near phrase")) return "near_phrase";
  if (normalized.includes("exact")) return "exact";
  if (normalized.includes("phrase")) return "phrase";
  if (normalized.includes("broad")) return "broad";
  return "unknown";
}

function stemToken(token: string): string {
  if (token.length > 4 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.length > 4 && token.endsWith("s") && !token.endsWith("ss")) {
    return token.slice(0, -1);
  }
  return token;
}

function stemmedTokens(value: string): string[] {
  return tokenizeNgrams(value)
    .filter((ngram) => ngram.size === 1)
    .map((ngram) => stemToken(ngram.value));
}

function bigramSet(tokens: readonly string[]): Set<string> {
  const result = new Set<string>();
  for (let index = 0; index < tokens.length - 1; index += 1) {
    result.add(`${tokens[index]} ${tokens[index + 1]}`);
  }
  return result;
}

function overlapRatio(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  if (left.size === 0) return 0;
  let overlap = 0;
  for (const value of left) {
    if (right.has(value)) overlap += 1;
  }
  return overlap / left.size;
}

function intentMismatchScore(keyword: IntentTier, query: IntentTier): number {
  if (keyword === query) return 0;
  if (query === "low_intent_irrelevant") return 1;
  if (keyword === "high_commercial" && query === "informational_consideration") return 0.7;
  if (keyword === "brand_intent" || query === "brand_intent") return 0.6;
  return 0.45;
}

function matchTypePenalty(matchType: NormalizedMatchType): number {
  if (matchType === "broad" || matchType === "ai_max") return 1;
  if (matchType === "near_phrase") return 0.65;
  if (matchType === "phrase") return 0.4;
  if (matchType === "near_exact") return 0.2;
  if (matchType === "exact") return 0;
  return 0.6;
}

export function analyzeMatchTypeDrift(
  input: SearchQueryPerformanceInput,
  options: Pick<WastedSpendAnalyzerOptions, "driftReviewThreshold" | "driftThreshold"> = {},
): MatchTypeDriftFinding {
  const queryIntent = classifySearchIntent(input.searchTerm);
  const keywordText = normalizeSearchQuery(input.keywordText);
  const keywordMatchType = normalizeMatchType(input.keywordMatchType);
  const searchTermMatchType = normalizeMatchType(input.searchTermMatchType ?? "");

  if (!keywordText) {
    return {
      searchTerm: input.searchTerm,
      keywordText: input.keywordText,
      keywordMatchType,
      searchTermMatchType,
      score: null,
      verdict: "insufficient_data",
      components: null,
      queryIntent: queryIntent.tier,
      keywordIntent: null,
      spend: input.spend,
      reason: "No target keyword was reported, so lexical drift cannot be measured.",
    };
  }

  const queryTokens = stemmedTokens(input.searchTerm);
  const targetTokens = stemmedTokens(keywordText);
  const querySet = new Set(queryTokens);
  const targetSet = new Set(targetTokens);
  const targetCoverage = overlapRatio(targetSet, querySet);
  const queryPrecision = overlapRatio(querySet, targetSet);
  const targetBigrams = bigramSet(targetTokens);
  const queryBigrams = bigramSet(queryTokens);
  const bigramCoverage = targetBigrams.size === 0
    ? targetCoverage
    : overlapRatio(targetBigrams, queryBigrams);
  const lexicalSimilarity =
    0.55 * targetCoverage + 0.25 * queryPrecision + 0.2 * bigramCoverage;
  const keywordIntent = classifySearchIntent(keywordText).tier;
  const intentMismatch = intentMismatchScore(keywordIntent, queryIntent.tier);
  const looseness = searchTermMatchType === "unknown"
    ? matchTypePenalty(keywordMatchType)
    : Math.max(matchTypePenalty(keywordMatchType), matchTypePenalty(searchTermMatchType));
  const lexicalDistance = 1 - lexicalSimilarity;
  const score = Math.min(
    1,
    Math.max(
      0,
      DRIFT_WEIGHTS.lexicalDistance * lexicalDistance
        + DRIFT_WEIGHTS.intentMismatch * intentMismatch
        + DRIFT_WEIGHTS.matchTypePenalty * looseness,
    ),
  );
  const reviewThreshold = options.driftReviewThreshold ?? 0.35;
  const driftThreshold = options.driftThreshold ?? 0.55;
  if (!(reviewThreshold >= 0 && reviewThreshold < driftThreshold && driftThreshold <= 1)) {
    throw new RangeError("Drift thresholds must satisfy 0 <= review < drift <= 1.");
  }
  const verdict: DriftVerdict = score >= driftThreshold
    ? "drifted"
    : score >= reviewThreshold
      ? "review"
      : "aligned";

  return {
    searchTerm: input.searchTerm,
    keywordText: input.keywordText,
    keywordMatchType,
    searchTermMatchType,
    score: round(score),
    verdict,
    components: {
      lexicalDistance: round(lexicalDistance),
      targetCoverage: round(targetCoverage),
      queryPrecision: round(queryPrecision),
      bigramCoverage: round(bigramCoverage),
      intentMismatch: round(intentMismatch),
      matchTypePenalty: round(looseness),
    },
    queryIntent: queryIntent.tier,
    keywordIntent,
    spend: input.spend,
    reason: verdict === "drifted"
      ? "The actual query is materially different from the target keyword or its commercial intent."
      : verdict === "review"
        ? "The query has a moderate lexical or intent departure and should be reviewed."
        : "The actual query remains close to the target keyword and intent.",
  };
}

function aggregateRows(rows: readonly SearchQueryPerformanceInput[]): AggregatedQuery[] {
  const grouped = new Map<string, AggregatedQuery>();

  for (const row of rows) {
    assertNonNegativeFinite(row.spend, "spend");
    assertNonNegativeFinite(row.impressions, "impressions");
    assertNonNegativeFinite(row.clicks, "clicks");
    if (row.registrations !== null) assertNonNegativeFinite(row.registrations, "registrations");
    if (row.purchases !== null) assertNonNegativeFinite(row.purchases, "purchases");

    const campaignKey = row.campaignKey ?? "";
    const adGroupKey = row.adGroupKey ?? "";
    const key = [
      normalizeSearchQuery(row.searchTerm),
      normalizeSearchQuery(row.keywordText),
      normalizeMatchType(row.keywordMatchType),
      campaignKey,
      adGroupKey,
    ].join("|");
    const existing = grouped.get(key);
    const measurementComplete = row.registrations !== null && row.purchases !== null;

    if (!existing) {
      grouped.set(key, {
        ...row,
        campaignKey,
        adGroupKey,
        purchaseValue: row.purchaseValue ?? null,
        conversionMeasurementComplete: measurementComplete,
      });
      continue;
    }

    existing.spend += row.spend;
    existing.impressions += row.impressions;
    existing.clicks += row.clicks;
    existing.conversionMeasurementComplete &&= measurementComplete;
    existing.registrations = existing.conversionMeasurementComplete
      ? (existing.registrations ?? 0) + (row.registrations ?? 0)
      : null;
    existing.purchases = existing.conversionMeasurementComplete
      ? (existing.purchases ?? 0) + (row.purchases ?? 0)
      : null;
    const rowPurchaseValue = row.purchaseValue ?? null;
    existing.purchaseValue = existing.purchaseValue !== null && rowPurchaseValue !== null
      ? existing.purchaseValue + rowPurchaseValue
      : null;
  }

  return [...grouped.values()];
}

function strongestLowIntentPhrase(intent: IntentClassification): string | null {
  const signal = intent.signals
    .filter((item) => item.tier === "low_intent_irrelevant")
    .toSorted((left, right) => right.weight - left.weight || right.pattern.length - left.pattern.length)[0];
  return signal?.pattern ?? null;
}

interface QualifiedNgramCluster {
  pattern: string;
  rows: AggregatedQuery[];
  spend: number;
  clicks: number;
}

function containsNgram(query: string, pattern: string): boolean {
  return tokenizeNgrams(query).some((ngram) => ngram.value === pattern);
}

/**
 * Small individual leaks can cross the economic threshold as a repeated
 * phrase. A phrase is eligible only when at least two distinct zero-conversion
 * queries share it and no measured converting query contains it.
 */
function qualifiedLowIntentClusters(
  measured: readonly AggregatedQuery[],
  zeroConversion: readonly AggregatedQuery[],
  threshold: number,
): QualifiedNgramCluster[] {
  const candidates = new Map<string, Set<AggregatedQuery>>();

  for (const row of zeroConversion) {
    const intent = classifySearchIntent(row.searchTerm);
    if (intent.tier !== "low_intent_irrelevant") continue;
    for (const signal of intent.signals) {
      if (signal.tier !== "low_intent_irrelevant") continue;
      const members = candidates.get(signal.pattern) ?? new Set<AggregatedQuery>();
      members.add(row);
      candidates.set(signal.pattern, members);
    }
  }

  return [...candidates.entries()]
    .map(([pattern, members]) => {
      const clusterRows = [...members];
      return {
        pattern,
        rows: clusterRows,
        spend: clusterRows.reduce((total, row) => total + row.spend, 0),
        clicks: clusterRows.reduce((total, row) => total + row.clicks, 0),
      };
    })
    .filter((cluster) => new Set(cluster.rows.map((row) => normalizeSearchQuery(row.searchTerm))).size >= 2)
    .filter((cluster) => cluster.spend >= threshold)
    .filter((cluster) => !measured.some(
      (row) =>
        (row.registrations ?? 0) + (row.purchases ?? 0) > 0
        && containsNgram(row.searchTerm, cluster.pattern),
    ))
    .toSorted((left, right) => right.spend - left.spend);
}

function commonScope(
  rows: readonly AggregatedQuery[],
  read: (row: AggregatedQuery) => string,
): string | null {
  const values = new Set(rows.map(read).filter(Boolean));
  return values.size === 1 ? [...values][0] : null;
}

export function analyzeWastedSpend(
  rows: readonly SearchQueryPerformanceInput[],
  options: WastedSpendAnalyzerOptions,
): WastedSpendAnalysis {
  if (!Number.isFinite(options.targetCostPerAcquisition) || options.targetCostPerAcquisition <= 0) {
    throw new RangeError("targetCostPerAcquisition must be a finite number greater than zero.");
  }
  const multiplier = options.minimumSpendMultiplier ?? 1;
  const days = options.daysInRange ?? 30;
  if (!Number.isFinite(multiplier) || multiplier <= 0) {
    throw new RangeError("minimumSpendMultiplier must be greater than zero.");
  }
  if (!Number.isFinite(days) || days <= 0) {
    throw new RangeError("daysInRange must be greater than zero.");
  }

  const threshold = options.targetCostPerAcquisition * multiplier;
  const aggregated = aggregateRows(rows);
  const spendAnalyzed = aggregated.reduce((total, row) => total + row.spend, 0);
  const measured = aggregated.filter((row) => row.conversionMeasurementComplete);
  const measuredSpend = measured.reduce((total, row) => total + row.spend, 0);
  const zeroConversion = measured.filter(
    (row) => (row.registrations ?? 0) + (row.purchases ?? 0) === 0,
  );
  const zeroConversionSpend = zeroConversion.reduce((total, row) => total + row.spend, 0);
  const directWaste = new Set(zeroConversion.filter((row) => row.spend >= threshold));
  const ngramClusters = qualifiedLowIntentClusters(measured, zeroConversion, threshold);
  const coveredWaste = new Set(directWaste);
  for (const cluster of ngramClusters) {
    for (const row of cluster.rows) coveredWaste.add(row);
  }
  const findings = [...coveredWaste]
    .map<WastedQueryFinding>((row) => {
      const ratio = row.spend / threshold;
      return {
        searchTerm: row.searchTerm,
        keywordText: row.keywordText,
        campaignKey: row.campaignKey || null,
        adGroupKey: row.adGroupKey || null,
        spend: round(row.spend, 2),
        clicks: row.clicks,
        conversions: 0,
        threshold: round(threshold, 2),
        spendToThresholdRatio: round(ratio),
        detectionBasis: directWaste.has(row) ? "query_threshold" : "ngram_cluster",
        severity: ratio >= 3 ? "critical" : ratio >= 1.5 ? "high" : "watch",
        intent: classifySearchIntent(row.searchTerm),
        drift: analyzeMatchTypeDrift(row, options),
      };
    })
    .toSorted((left, right) => right.spend - left.spend);

  const exactRecommendationCandidates = findings
    .filter((finding) => finding.detectionBasis === "query_threshold")
    .filter(
      (finding) => finding.intent.tier === "low_intent_irrelevant" || finding.drift.verdict === "drifted",
    )
    .map<NegativeKeywordRecommendation>((finding) => {
      const normalized = normalizeSearchQuery(finding.searchTerm);
      const phrase = strongestLowIntentPhrase(finding.intent);
      const reason = finding.intent.tier === "low_intent_irrelevant"
        ? `${finding.intent.label}; spent above the zero-conversion threshold.`
        : "Material match-type drift with spend above the zero-conversion threshold.";
      const exportRow: NegativeKeywordExportRow = {
        negativeKeyword: normalized,
        matchType: "exact",
        campaignKey: finding.campaignKey,
        adGroupKey: finding.adGroupKey,
        reason,
        sourceSpend: finding.spend,
        approvalRequired: true,
      };
      return {
        query: finding.searchTerm,
        basis: "query",
        matchedQueryCount: 1,
        suggestedExact: `[${normalized}]`,
        suggestedPhrase: phrase ? `"${phrase}"` : null,
        reason,
        spendWasted: finding.spend,
        clicks: finding.clicks,
        approvalRequired: true,
        exportRow,
      };
    });
  const phraseRecommendationCandidates = ngramClusters.map<NegativeKeywordRecommendation>(
    (cluster) => {
      const reason = `${cluster.rows.length} measured zero-conversion queries share this low-intent phrase and collectively crossed the spend threshold.`;
      const exportRow: NegativeKeywordExportRow = {
        negativeKeyword: cluster.pattern,
        matchType: "phrase",
        campaignKey: commonScope(cluster.rows, (row) => row.campaignKey),
        adGroupKey: commonScope(cluster.rows, (row) => row.adGroupKey),
        reason,
        sourceSpend: round(cluster.spend, 2),
        approvalRequired: true,
      };
      return {
        query: cluster.pattern,
        basis: "ngram_cluster",
        matchedQueryCount: cluster.rows.length,
        suggestedExact: null,
        suggestedPhrase: `"${cluster.pattern}"`,
        reason,
        spendWasted: round(cluster.spend, 2),
        clicks: cluster.clicks,
        approvalRequired: true,
        exportRow,
      };
    },
  );
  // A query may have matched several positive keywords on different days.
  // One scoped exact negative is enough; duplicate export rows invite operator
  // mistakes without blocking any additional traffic.
  const recommendations = [...new Map(
    [...exactRecommendationCandidates, ...phraseRecommendationCandidates].map((recommendation) => [
      [
        recommendation.exportRow.negativeKeyword,
        recommendation.exportRow.matchType,
        recommendation.exportRow.campaignKey ?? "",
        recommendation.exportRow.adGroupKey ?? "",
      ].join("|"),
      recommendation,
    ]),
  ).values()].toSorted((left, right) => right.spendWasted - left.spendWasted);

  const driftFindings = aggregated.map((row) => analyzeMatchTypeDrift(row, options));
  const eligibleDrift = driftFindings.filter(
    (finding): finding is MatchTypeDriftFinding & { score: number } => finding.score !== null,
  );
  const eligibleSpend = eligibleDrift.reduce((total, finding) => total + finding.spend, 0);
  const driftedSpend = eligibleDrift
    .filter((finding) => finding.verdict === "drifted")
    .reduce((total, finding) => total + finding.spend, 0);
  const weightedDrift = eligibleSpend === 0
    ? null
    : eligibleDrift.reduce((total, finding) => total + finding.score * finding.spend, 0) / eligibleSpend;
  const totalWastedAmount = [...coveredWaste].reduce((total, row) => total + row.spend, 0);

  return {
    spendAnalyzed: round(spendAnalyzed, 2),
    measuredSpend: round(measuredSpend, 2),
    unmeasuredConversionSpend: round(spendAnalyzed - measuredSpend, 2),
    zeroConversionSpend: round(zeroConversionSpend, 2),
    totalWastedAmount: round(totalWastedAmount, 2),
    // Unknown conversion rows stay in the denominator but never the numerator:
    // this is conservative and prevents incomplete measurement from inflating
    // the apparent share of waste.
    wastedSpendPercent: spendAnalyzed === 0 ? 0 : round((totalWastedAmount / spendAnalyzed) * 100, 1),
    monthlyProjectedSavings: round((totalWastedAmount / days) * 30, 2),
    flaggedQueryCount: findings.length,
    findings,
    recommendations,
    negativeKeywordExportRows: recommendations.map((recommendation) => recommendation.exportRow),
    matchTypeDrift: {
      eligibleSpend: round(eligibleSpend, 2),
      driftedSpend: round(driftedSpend, 2),
      driftedSpendPercent: eligibleSpend === 0 ? 0 : round((driftedSpend / eligibleSpend) * 100, 1),
      driftIndexPercent: weightedDrift === null ? null : round(weightedDrift * 100, 1),
      findings: driftFindings.toSorted((left, right) => (right.score ?? -1) - (left.score ?? -1)),
    },
  };
}
