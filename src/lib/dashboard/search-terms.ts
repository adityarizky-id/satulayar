import {
  classifySearchIntent,
  DEFAULT_INTENT_PROFILE,
  normalizeSearchQuery,
  resolveIntentProfile,
  type IntentProfile,
} from "@/lib/analytics/intent-classifier";
import { liveCampaignTypeLabel } from "@/lib/dashboard/campaign-types";
import {
  reportingCycleByIndex,
  resolveReportingCycleForRange,
} from "@/lib/dashboard/timeframes";
import { volumeVerdict } from "@/lib/dashboard/confidence";
import type { PerformanceTargets } from "@/lib/dashboard/targets";
import type { Currency, DateRange } from "@/lib/dashboard/types";

/**
 * Google's keyword match types. Search terms carry their own match too.
 *
 * `unknown` exists for stored rows whose keyword match type Google did not
 * report — Shopping and Dynamic Search Ads rows have no keyword at all. It is
 * a fail-safe, not a bucket to route doubtful values into: calling a keyword
 * "broad" when the platform never said so is the same class of invention the
 * live path exists to remove, and a reader would act on it.
 */
export type MatchType = "exact" | "phrase" | "broad" | "unknown";

export const MATCH_TYPE_LABELS: Record<MatchType, string> = {
  exact: "Exact",
  phrase: "Phrase",
  broad: "Broad",
  unknown: "Not reported",
};

/**
 * How the query matched, which is a wider set than a keyword can carry.
 *
 * Google reports close variants (`NEAR_EXACT`, `NEAR_PHRASE`) separately from
 * the strict match, and — since AI Max for Search — `AI_MAX`, which is not a
 * match type at all but a keywordless expansion. It can be a large share of an
 * account's rows, so folding it into "broad" would describe a
 * targeting setting the account does not use and would send a negative-keyword
 * decision at the wrong lever. Each value therefore keeps its own identity.
 */
export type SearchTermMatchType =
  | MatchType
  | "near-exact"
  | "near-phrase"
  | "ai-max";

export const SEARCH_TERM_MATCH_TYPE_LABELS: Record<SearchTermMatchType, string> = {
  exact: "Exact",
  phrase: "Phrase",
  broad: "Broad",
  "near-exact": "Close variant of exact",
  "near-phrase": "Close variant of phrase",
  "ai-max": "AI Max expansion",
  unknown: "Not reported",
};

/** Google `segments.keyword.info.match_type` onto the dashboard's own value. */
export function toKeywordMatchType(platformValue: string): MatchType {
  switch (platformValue.trim().toUpperCase()) {
    case "EXACT":
      return "exact";
    case "PHRASE":
      return "phrase";
    case "BROAD":
      return "broad";
    default:
      return "unknown";
  }
}

/** Google `segments.search_term_match_type` onto the dashboard's own value. */
export function toSearchTermMatchType(platformValue: string): SearchTermMatchType {
  switch (platformValue.trim().toUpperCase()) {
    case "EXACT":
      return "exact";
    case "PHRASE":
      return "phrase";
    case "BROAD":
      return "broad";
    case "NEAR_EXACT":
      return "near-exact";
    case "NEAR_PHRASE":
      return "near-phrase";
    case "AI_MAX":
      return "ai-max";
    default:
      return "unknown";
  }
}

/**
 * How far back the comparison looks. "previous" is the equal-length window
 * immediately before the selected period, "previous-cycle" is the whole 30-day
 * reporting cycle before it, "previous-year" is the same dates one year
 * earlier, "custom" is an explicit range the reader picked, and the rest are
 * rolling windows ending the day before the selected period.
 *
 * There is deliberately no calendar-month baseline. reporting runs on
 * repeating 30-day cycles anchored to a fixed date, so a Gregorian month
 * compares a period against a window the team never reports on — and the
 * budget card, already paced against the cycle, would disagree with every
 * delta on the same screen.
 */
export type ComparisonWindow =
  | "previous"
  | "previous-cycle"
  | "previous-year"
  | "30d"
  | "90d"
  | "180d"
  | "365d"
  | "custom";

export const COMPARISON_WINDOW_LABELS: Record<ComparisonWindow, string> = {
  previous: "Previous period",
  "previous-cycle": "Previous 30-day cycle",
  "previous-year": "Same period last year",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  "180d": "Last 180 days",
  "365d": "Last 365 days",
  custom: "Custom period",
};

/**
 * Accepts the retired `previous-month` value and returns the cycle baseline
 * that replaced it, so a saved link or cookie keeps resolving to a real
 * window instead of silently falling back to the default.
 */
export function normaliseComparisonWindow(
  value: string | null | undefined,
): ComparisonWindow | undefined {
  if (!value) return undefined;
  if (value === "previous-month") return "previous-cycle";
  return value in COMPARISON_WINDOW_LABELS
    ? (value as ComparisonWindow)
    : undefined;
}

function shiftDate(date: string, days: number): string {
  const parsed = Date.parse(`${date}T00:00:00Z`);
  return new Date(parsed + days * 86_400_000).toISOString().slice(0, 10);
}

function daysBetween(range: DateRange): number {
  const start = Date.parse(`${range.start}T00:00:00Z`);
  const end = Date.parse(`${range.end}T00:00:00Z`);
  return Math.floor((end - start) / 86_400_000) + 1;
}

function shiftCalendarYearBack(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const targetYear = year - 1;
  const lastDayOfTargetMonth = new Date(
    Date.UTC(targetYear, month, 0),
  ).getUTCDate();
  return [
    targetYear,
    String(month).padStart(2, "0"),
    String(Math.min(day, lastDayOfTargetMonth)).padStart(2, "0"),
  ].join("-");
}

/**
 * `customRange` is only consulted for the "custom" window. When that window is
 * requested without a range — an incomplete draft, or a stale URL — the
 * comparison falls back to the equal-length previous period rather than
 * silently reporting against nothing.
 */
export function resolveComparisonRange(
  range: DateRange,
  window: ComparisonWindow,
  customRange?: DateRange | null,
): DateRange {
  if (window === "custom" && customRange) {
    return customRange;
  }

  if (window === "previous" || window === "custom") {
    const length = daysBetween(range);
    return {
      start: shiftDate(range.start, -length),
      end: shiftDate(range.end, -length),
    };
  }

  if (window === "previous-cycle") {
    // The whole 30-day reporting cycle before the one the period ends in. The
    // end day decides, matching how the budget card resolves its own cycle, so
    // the two never describe different windows on the same screen.
    const current = resolveReportingCycleForRange(range);
    const previous = reportingCycleByIndex(current.index - 1);
    return { start: previous.start, end: previous.end };
  }

  if (window === "previous-year") {
    return {
      start: shiftCalendarYearBack(range.start),
      end: shiftCalendarYearBack(range.end),
    };
  }

  const lookback = Number(window.replace("d", ""));
  const end = shiftDate(range.start, -1);
  return { start: shiftDate(end, -(lookback - 1)), end };
}

/**
 * Why a term was called irrelevant. `source` says who decided: today every
 * verdict comes from the rules below, and the UI labels it as such. An agent
 * filling the same contract later changes the label, not the shape.
 */
export interface RelevanceVerdict {
  verdict: "relevant" | "review" | "irrelevant";
  source: "rule-based" | "agent";
  /** Shown in the tooltip, so a reader never sees a verdict without a why. */
  reason: string;
  /** The individual signals that fired, for the expanded explanation. */
  signals: string[];
}

/**
 * Queries are read by one classifier, shared with the intent ladder and the
 * waste panel that sit in the same section.
 *
 * There used to be a second set of rules here — five English token lists — and
 * the two disagreed on the same query in the same panel: "how to start coffee
 * supplies" was early-stage discovery on one tab and wrong intent on the next.
 * A panel that contradicts itself cannot be acted on, so the local rules are
 * gone and `classifySearchIntent` is the only reader.
 */
function tokenise(term: string): string[] {
  return normalizeSearchQuery(term).split(" ").filter(Boolean);
}

export interface SearchTermMetrics {
  spend: number;
  impressions: number;
  clicks: number;
  registrations: number;
  purchases: number;
  purchaseValue: number;
}

export interface SearchTermRow extends SearchTermMetrics {
  id: string;
  term: string;
  keyword: string;
  keywordMatchType: MatchType;
  /** How the term matched the keyword, which can be looser than the keyword. */
  termMatchType: SearchTermMatchType;
  campaignType: string;
  /**
   * False when the conversion pull did not run or failed for this row, so the
   * zeroes in `registrations` and `purchases` mean "not measured" rather than
   * "nothing converted". Waste and relevance both refuse to judge on money
   * alone in that state: "$12 spent, no orders" would otherwise be read as a
   * negative-keyword candidate on the strength of a missing query.
   */
  conversionsMeasured: boolean;
  ctr: number | null;
  cpc: number | null;
  costPerPurchase: number | null;
  costPerRegistration: number | null;
  returnOnAdSpend: number | null;
  /** Same term over the chosen comparison window. */
  previous: SearchTermMetrics | null;
  relevance: RelevanceVerdict;
  waste: WasteVerdict;
}

/**
 * Waste is judged on the rule the product owner set: a term that produced neither an
 * order nor a registration, having spent more than one order is meant to cost.
 * Direction against the comparison window is carried separately so a term that
 * is merely getting worse is not confused with one that never worked.
 */
export type WasteLevel =
  | "spending-nothing-back"
  | "declining"
  | "healthy"
  | "too-early"
  /** Conversions were not measured for this row, so waste cannot be judged. */
  | "not-measured";

export interface WasteVerdict {
  level: WasteLevel;
  /** Change in conversions against the comparison window, as a fraction. */
  conversionChange: number | null;
  safeMessage: string;
}

function conversionsOf(metrics: SearchTermMetrics): number {
  return metrics.purchases + metrics.registrations;
}

export function judgeWaste(
  row: SearchTermMetrics,
  previous: SearchTermMetrics | null,
  targets: PerformanceTargets,
  currency: Currency,
  /** False when the conversion pull did not land for this row. */
  conversionsMeasured = true,
): WasteVerdict {
  const money = (value: number) =>
    new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(value);

  if (!conversionsMeasured) {
    return {
      level: "not-measured",
      conversionChange: null,
      safeMessage: `${money(row.spend)} spent, but conversions were not measured for this query, so whether it paid back is unknown. Do not read the zero as a failure.`,
    };
  }

  const conversions = conversionsOf(row);
  const previousConversions = previous ? conversionsOf(previous) : null;
  const conversionChange =
    previousConversions === null || previousConversions === 0
      ? null
      : (conversions - previousConversions) / previousConversions;

  if (conversions === 0) {
    return row.spend >= targets.costPerOrder
      ? {
          level: "spending-nothing-back",
          conversionChange,
          safeMessage: `${money(row.spend)} spent with no order and no registration, which is already more than one order is meant to cost.`,
        }
      : {
          level: "too-early",
          conversionChange,
          safeMessage: `Only ${money(row.spend)} spent, below the cost of a single order, so nothing was expected back yet.`,
        };
  }

  if (conversionChange !== null && conversionChange <= -0.3) {
    return {
      level: "declining",
      conversionChange,
      safeMessage: `Conversions fell ${Math.abs(Math.round(conversionChange * 100))}% against the comparison window.`,
    };
  }

  return {
    level: "healthy",
    conversionChange,
    safeMessage: `${conversions} conversion${conversions === 1 ? "" : "s"} in the period.`,
  };
}

export function judgeRelevance(
  term: string,
  metrics: SearchTermMetrics,
  targets: PerformanceTargets,
  /** False when the conversion pull did not land for this row. */
  conversionsMeasured = true,
  /** Brand aliases and market lexicon for the account being read. */
  profile: IntentProfile = DEFAULT_INTENT_PROFILE,
): RelevanceVerdict {
  const classification = classifySearchIntent(term, profile);
  const signals = classification.signals.map((signal) => signal.reason);

  // A query that produced an order is never called wrong intent on wording
  // alone. The rules read the words; the order is evidence about the buyer.
  const converted = conversionsMeasured && metrics.purchases > 0;

  if (
    classification.classified
    && classification.tier === "low_intent_irrelevant"
    && !converted
  ) {
    return {
      verdict: "irrelevant",
      source: "rule-based",
      reason: `Flagged because the query ${signals.join(", and ")}. Confirm before adding a negative keyword — a rule cannot see your catalogue.`,
      signals,
    };
  }

  if (
    classification.classified
    && classification.tier === "low_intent_irrelevant"
    && converted
  ) {
    return {
      verdict: "review",
      source: "rule-based",
      reason: `The wording reads as the wrong intent — ${signals.join(", and ")} — but this query produced ${metrics.purchases} order${metrics.purchases === 1 ? "" : "s"}. Read it before excluding it.`,
      signals: [...signals, "converted despite the wording"],
    };
  }

  // No intent signal, but the money says something is wrong: send it to a
  // human rather than calling it irrelevant on cost alone. Only when the
  // conversions were actually measured — otherwise the "without converting"
  // half of the sentence is not a fact about the query.
  if (
    conversionsMeasured &&
    conversionsOf(metrics) === 0 &&
    metrics.spend >= targets.costPerOrder
  ) {
    return {
      verdict: "review",
      source: "rule-based",
      reason:
        "No wording suggests the wrong intent, but it has spent more than an order should cost without converting. Worth reading before deciding.",
      signals: ["spend without conversion"],
    };
  }

  return {
    verdict: "relevant",
    source: "rule-based",
    reason: "Nothing in the wording or the numbers suggests the wrong intent.",
    signals: [],
  };
}

/** A word or pair of words shared by several search terms. */
export interface NgramGroup {
  token: string;
  terms: number;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number | null;
  registrations: number;
  purchases: number;
  /** Terms in this group the rules flagged as irrelevant. */
  irrelevantTerms: number;
  /** Spend sitting on the flagged terms only — what a negative would stop. */
  flaggedSpend: number;
  /**
   * Terms in this group that spent past the cost of an order without
   * converting but carry no wording signal. They are not negative-keyword
   * candidates, but a word that gathers several of them is still a pattern
   * worth reading, and the leak view used to hide those groups entirely.
   */
  reviewTerms: number;
  /** Spend sitting on those terms. */
  reviewSpend: number;
  rows: SearchTermRow[];
}

/**
 * Words that join everything to everything, in every market this dashboard
 * reads. An English-only list left `dan`, `untuk` and `yang` free to become the
 * top-ranked "leak" in an Indonesian account — a grammatical particle presented
 * as a negative-keyword candidate.
 */
const STOP_WORDS = new Set([
  // English
  "the", "a", "an", "for", "and", "of", "to", "in", "on", "with",
  // Indonesian
  "dan", "atau", "yang", "di", "ke", "dari", "untuk", "dengan", "ini", "itu",
  "pada", "buat", "jual", "murah",
  // Malay
  "dan", "atau", "yang", "untuk", "dengan", "dari", "ke", "di",
]);

/**
 * Groups terms by the words they share, which is how a leak becomes visible:
 * twenty different queries wasting a little each look harmless until the word
 * they have in common is added up.
 */
export function buildNgramGroups(
  rows: readonly SearchTermRow[],
  minimumTerms = 2,
): NgramGroup[] {
  const groups = new Map<string, SearchTermRow[]>();

  for (const row of rows) {
    for (const token of new Set(tokenise(row.term))) {
      if (STOP_WORDS.has(token) || token.length < 3) continue;
      const existing = groups.get(token);
      if (existing) existing.push(row);
      else groups.set(token, [row]);
    }
  }

  return [...groups.entries()]
    .filter(([, members]) => members.length >= minimumTerms)
    .map(([token, members]) => {
      const impressions = members.reduce((t, r) => t + r.impressions, 0);
      const clicks = members.reduce((t, r) => t + r.clicks, 0);

      return {
        token,
        terms: members.length,
        spend: Math.round(members.reduce((t, r) => t + r.spend, 0) * 100) / 100,
        impressions,
        clicks,
        ctr: impressions === 0 ? null : clicks / impressions,
        registrations: members.reduce((t, r) => t + r.registrations, 0),
        purchases: members.reduce((t, r) => t + r.purchases, 0),
        irrelevantTerms: members.filter(
          (r) => r.relevance.verdict === "irrelevant",
        ).length,
        flaggedSpend:
          Math.round(
            members
              .filter((r) => r.relevance.verdict === "irrelevant")
              .reduce((t, r) => t + r.spend, 0) * 100,
          ) / 100,
        reviewTerms: members.filter((r) => r.relevance.verdict === "review")
          .length,
        reviewSpend:
          Math.round(
            members
              .filter((r) => r.relevance.verdict === "review")
              .reduce((t, r) => t + r.spend, 0) * 100,
          ) / 100,
        rows: members.toSorted((left, right) => right.spend - left.spend),
      };
    })
    // Ranked by the money a negative keyword would actually stop, then by the
    // money waiting on a human read.
    .toSorted(
      (left, right) =>
        right.flaggedSpend - left.flaggedSpend
        || right.reviewSpend - left.reviewSpend,
    );
}

export interface MatchTypeSummary {
  matchType: MatchType;
  label: string;
  keywords: number;
  terms: number;
  spend: number;
  purchases: number;
  registrations: number;
  costPerPurchase: number | null;
  /** Share of this match type's spend sitting on terms flagged irrelevant. */
  irrelevantSpendShare: number;
  safeMessage: string;
}

/** Reads naturally in a sentence; "not reported keywords" would not. */
function matchTypePhrase(matchType: MatchType): string {
  return matchType === "unknown"
    ? "queries whose keyword match type Google did not report"
    : `${MATCH_TYPE_LABELS[matchType].toLowerCase()} keywords`;
}

/**
 * `unknown` is included so a row whose keyword match type Google never reported
 * still carries its spend into the summary. Dropping it would make the match
 * types silently fail to add up to the section total.
 */
export function summariseMatchTypes(
  rows: readonly SearchTermRow[],
): MatchTypeSummary[] {
  return (["exact", "phrase", "broad", "unknown"] as MatchType[])
    .map((matchType) => {
      const members = rows.filter((row) => row.keywordMatchType === matchType);
      const spend = Math.round(members.reduce((t, r) => t + r.spend, 0) * 100) / 100;
      const purchases = members.reduce((t, r) => t + r.purchases, 0);
      const irrelevantSpend = members
        .filter((row) => row.relevance.verdict === "irrelevant")
        .reduce((total, row) => total + row.spend, 0);
      const share = spend === 0 ? 0 : irrelevantSpend / spend;

      return {
        matchType,
        label: MATCH_TYPE_LABELS[matchType],
        keywords: new Set(members.map((row) => row.keyword)).size,
        terms: members.length,
        spend,
        purchases,
        registrations: members.reduce((t, r) => t + r.registrations, 0),
        costPerPurchase: purchases === 0 ? null : spend / purchases,
        irrelevantSpendShare: share,
        safeMessage:
          members.length === 0
            ? `No ${matchTypePhrase(matchType)} served in this period.`
            : share > 0.15
              ? `${Math.round(share * 100)}% of ${matchTypePhrase(matchType)} spend sits on queries the rules flagged as the wrong intent.`
              : `${Math.round(share * 100)}% of spend flagged, which is within the usual range.`,
      };
    })
    .filter((summary) => summary.terms > 0);
}

export interface KeywordRow {
  keyword: string;
  matchType: MatchType;
  terms: number;
  spend: number;
  clicks: number;
  impressions: number;
  registrations: number;
  purchases: number;
  purchaseValue: number;
  ctr: number | null;
  costPerPurchase: number | null;
  costPerRegistration: number | null;
  returnOnAdSpend: number | null;
  irrelevantSpend: number;
  waste: WasteVerdict;
}

/** Rolls the terms back up to the keyword that triggered them. */
export function buildKeywordRows(
  rows: readonly SearchTermRow[],
  targets: PerformanceTargets,
  currency: Currency,
): KeywordRow[] {
  const grouped = new Map<string, SearchTermRow[]>();
  for (const row of rows) {
    const key = `${row.keyword}|${row.keywordMatchType}`;
    const existing = grouped.get(key);
    if (existing) existing.push(row);
    else grouped.set(key, [row]);
  }

  return [...grouped.values()]
    .map((members) => {
      const sum = (read: (row: SearchTermRow) => number) =>
        members.reduce((total, row) => total + read(row), 0);
      const spend = Math.round(sum((row) => row.spend) * 100) / 100;
      const purchases = sum((row) => row.purchases);
      const registrations = sum((row) => row.registrations);
      const clicks = sum((row) => row.clicks);
      const impressions = sum((row) => row.impressions);
      const purchaseValue = Math.round(sum((row) => row.purchaseValue) * 100) / 100;
      const previous = members.some((row) => row.previous !== null)
        ? members.reduce<SearchTermMetrics>(
            (total, row) => ({
              spend: total.spend + (row.previous?.spend ?? 0),
              impressions: total.impressions + (row.previous?.impressions ?? 0),
              clicks: total.clicks + (row.previous?.clicks ?? 0),
              registrations:
                total.registrations + (row.previous?.registrations ?? 0),
              purchases: total.purchases + (row.previous?.purchases ?? 0),
              purchaseValue:
                total.purchaseValue + (row.previous?.purchaseValue ?? 0),
            }),
            {
              spend: 0,
              impressions: 0,
              clicks: 0,
              registrations: 0,
              purchases: 0,
              purchaseValue: 0,
            },
          )
        : null;

      const metrics: SearchTermMetrics = {
        spend,
        impressions,
        clicks,
        registrations,
        purchases,
        purchaseValue,
      };

      return {
        keyword: members[0].keyword,
        matchType: members[0].keywordMatchType,
        terms: members.length,
        spend,
        clicks,
        impressions,
        registrations,
        purchases,
        purchaseValue,
        ctr: impressions === 0 ? null : clicks / impressions,
        costPerPurchase: purchases === 0 ? null : spend / purchases,
        costPerRegistration: registrations === 0 ? null : spend / registrations,
        returnOnAdSpend: spend === 0 ? null : purchaseValue / spend,
        irrelevantSpend:
          Math.round(
            members
              .filter((row) => row.relevance.verdict === "irrelevant")
              .reduce((total, row) => total + row.spend, 0) * 100,
          ) / 100,
        waste: judgeWaste(metrics, previous, targets, currency),
      };
    })
    .toSorted((left, right) => right.spend - left.spend);
}

export interface SearchTermAnalysis {
  platform: "google";
  range: DateRange;
  comparisonRange: DateRange;
  comparisonWindow: ComparisonWindow;
  currency: Currency;
  rows: SearchTermRow[];
  keywords: KeywordRow[];
  ngrams: NgramGroup[];
  matchTypes: MatchTypeSummary[];
  totals: {
    spend: number;
    clicks: number;
    registrations: number;
    purchases: number;
    /** Spend on terms the rules flagged as the wrong intent. */
    irrelevantSpend: number;
    /** Spend Google withheld because the term fell below its threshold. */
    belowThresholdSpend: number;
  };
  safeMessage: string;
  /**
   * `synthetic-illustration` means invented keywords and queries scaled from
   * account spend. The section must say so before anyone adds a negative.
   */
  dataOrigin: "synthetic-illustration" | "platform";
}

export function volumeIsReadable(row: SearchTermMetrics): boolean {
  return volumeVerdict(conversionsOf(row)).confidence !== "insufficient";
}

/**
 * One stored `ad_search_term_daily` row as the reader returns it.
 *
 * Match types stay verbatim platform strings here and are normalised inside the
 * builder, so a value Google adds later (`AI_MAX` was one) reaches the mapping
 * in one place instead of being silently coerced at the database boundary.
 * Conversion fields keep their null, which means "not measured" and never zero.
 */
export interface StoredSearchTermRow {
  date: string;
  campaignKey: string;
  adGroupKey: string;
  searchTerm: string;
  searchTermMatchType: string;
  keywordText: string;
  keywordMatchType: string;
  currency: Currency;
  spend: number;
  impressions: number;
  clicks: number;
  registrations: number | null;
  purchases: number | null;
  purchaseValue: number | null;
  isProvisional: boolean;
}

export interface LiveSearchTermInput {
  /** Rows inside the selected period. */
  rows: readonly StoredSearchTermRow[];
  /** Rows inside the comparison window, for the period-over-period read-out. */
  comparisonRows?: readonly StoredSearchTermRow[];
  range: DateRange;
  comparisonRange: DateRange;
  comparisonWindow: ComparisonWindow;
  currency: Currency;
  targets: PerformanceTargets;
  /** Channel type per campaign key, from `ad_campaigns`. */
  campaignChannelTypes?: ReadonlyMap<string, string>;
  /**
   * Spend on the campaigns whose queries this report can cover (Search and
   * Shopping), taken from the stored campaign rows. It is the denominator for
   * the withheld-query gap. Null when campaign rows were not read, and the gap
   * is then reported as unavailable rather than as zero.
   */
  queryCampaignSpend?: number | null;
  /**
   * The account whose queries these are. It selects the market lexicon and the
   * brand aliases, so the same query is read as Indonesian rather than as
   * unmatched English. Omitted, the reader falls back to English with no brand
   * detection and says so through the unclassified share.
   */
  accountSlug?: string | null;
}

/** Aggregation grain: one row per campaign, query, and matched keyword. */
function storedTermKey(row: StoredSearchTermRow): string {
  return [
    row.campaignKey,
    row.searchTerm,
    row.searchTermMatchType,
    row.keywordText,
    row.keywordMatchType,
  ].join("\u0000");
}

interface StoredTermGroup {
  rows: StoredSearchTermRow[];
  metrics: SearchTermMetrics;
  /** True only when every day in the group carried measured conversions. */
  conversionsMeasured: boolean;
}

function groupStoredTerms(
  rows: readonly StoredSearchTermRow[],
): Map<string, StoredTermGroup> {
  const groups = new Map<string, StoredTermGroup>();

  for (const row of rows) {
    const key = storedTermKey(row);
    const measured = row.registrations !== null && row.purchases !== null;
    const existing = groups.get(key);

    if (existing) {
      existing.rows.push(row);
      existing.metrics.spend += row.spend;
      existing.metrics.impressions += row.impressions;
      existing.metrics.clicks += row.clicks;
      existing.metrics.registrations += row.registrations ?? 0;
      existing.metrics.purchases += row.purchases ?? 0;
      existing.metrics.purchaseValue += row.purchaseValue ?? 0;
      // One unmeasured day makes the group's total unmeasured: a partial sum
      // presented as a total is the same misstatement in a smaller font.
      existing.conversionsMeasured = existing.conversionsMeasured && measured;
      continue;
    }

    groups.set(key, {
      rows: [row],
      metrics: {
        spend: row.spend,
        impressions: row.impressions,
        clicks: row.clicks,
        registrations: row.registrations ?? 0,
        purchases: row.purchases ?? 0,
        purchaseValue: row.purchaseValue ?? 0,
      },
      conversionsMeasured: measured,
    });
  }

  return groups;
}

function roundMetrics(metrics: SearchTermMetrics): SearchTermMetrics {
  return {
    spend: Math.round(metrics.spend * 100) / 100,
    impressions: metrics.impressions,
    clicks: metrics.clicks,
    registrations: metrics.registrations,
    purchases: metrics.purchases,
    purchaseValue: Math.round(metrics.purchaseValue * 100) / 100,
  };
}

function scaleMetrics(
  metrics: SearchTermMetrics,
  factor: number,
): SearchTermMetrics {
  if (factor === 1) return metrics;
  return {
    spend: metrics.spend * factor,
    impressions: metrics.impressions * factor,
    clicks: metrics.clicks * factor,
    registrations: metrics.registrations * factor,
    purchases: metrics.purchases * factor,
    purchaseValue: metrics.purchaseValue * factor,
  };
}

const EMPTY_METRICS: SearchTermMetrics = {
  spend: 0,
  impressions: 0,
  clicks: 0,
  registrations: 0,
  purchases: 0,
  purchaseValue: 0,
};

/**
 * Builds the search-query section from stored `ad_search_term_daily` rows.
 *
 * Returns null when no row exists for the period, so the caller leaves the
 * pending placeholder in place instead of falling back to generated keywords —
 * this section's whole purpose is to decide negatives, and a negative added
 * from an invented query is a real change made on a fiction.
 *
 * Four limits are carried in the output rather than papered over:
 *   1. Rows exclude Dynamic Search Ads queries (the pull selects the matched
 *      keyword, which drops them) and the queries Google withholds below its
 *      privacy threshold, so they never add up to campaign spend.
 *   2. A group whose conversions were not measured is marked, not scored.
 *   3. A missing comparison window reads as no change available, not as a fall
 *      to zero.
 *   4. The campaign a query ran under is named from `ad_campaigns` when it is
 *      stored, and left as the platform's channel type or "Unclassified" when
 *      it is not.
 */
export function buildSearchTermAnalysisFromRows(
  input: LiveSearchTermInput,
): SearchTermAnalysis | null {
  if (input.rows.length === 0) return null;

  const profile = resolveIntentProfile(input.accountSlug);
  const activeDays = daysBetween(input.range);
  const comparisonDays = daysBetween(input.comparisonRange);
  const comparisonFactor = comparisonDays > 0 ? activeDays / comparisonDays : 1;

  const current = groupStoredTerms(input.rows);
  const previous = groupStoredTerms(input.comparisonRows ?? []);
  const hasComparisonRows = (input.comparisonRows ?? []).length > 0;

  let unmeasuredGroups = 0;
  let unmeasuredSpend = 0;

  const rows: SearchTermRow[] = [...current.entries()]
    .map(([key, group]) => {
      const sample = group.rows[0];
      const metrics = roundMetrics(group.metrics);
      const previousGroup = previous.get(key);
      // No comparison row at all is a different statement from a comparison of
      // zero: the first means the window was not read, the second that the
      // query did not serve. Only the second is a real fall to report.
      const comparable = hasComparisonRows
        ? roundMetrics(
            scaleMetrics(previousGroup?.metrics ?? EMPTY_METRICS, comparisonFactor),
          )
        : null;

      if (!group.conversionsMeasured) {
        unmeasuredGroups += 1;
        unmeasuredSpend += metrics.spend;
      }

      const channelType = input.campaignChannelTypes?.get(sample.campaignKey) ?? "";

      return {
        id: key,
        term: sample.searchTerm,
        keyword: sample.keywordText || "(no keyword reported)",
        keywordMatchType: toKeywordMatchType(sample.keywordMatchType),
        termMatchType: toSearchTermMatchType(sample.searchTermMatchType),
        campaignType: liveCampaignTypeLabel(channelType),
        conversionsMeasured: group.conversionsMeasured,
        ...metrics,
        ctr:
          metrics.impressions === 0 ? null : metrics.clicks / metrics.impressions,
        cpc: metrics.clicks === 0 ? null : metrics.spend / metrics.clicks,
        // A cost per order needs a measured order count. Dividing by an
        // unmeasured zero would publish "no orders at any price".
        costPerPurchase:
          !group.conversionsMeasured || metrics.purchases === 0
            ? null
            : metrics.spend / metrics.purchases,
        costPerRegistration:
          !group.conversionsMeasured || metrics.registrations === 0
            ? null
            : metrics.spend / metrics.registrations,
        returnOnAdSpend:
          !group.conversionsMeasured || metrics.spend === 0
            ? null
            : metrics.purchaseValue / metrics.spend,
        previous: comparable,
        relevance: judgeRelevance(
          sample.searchTerm,
          metrics,
          input.targets,
          group.conversionsMeasured,
          profile,
        ),
        waste: judgeWaste(
          metrics,
          comparable,
          input.targets,
          input.currency,
          group.conversionsMeasured,
        ),
      };
    })
    .toSorted((left, right) => right.spend - left.spend);

  const round2 = (value: number) => Math.round(value * 100) / 100;
  const totalSpend = round2(rows.reduce((total, row) => total + row.spend, 0));
  const irrelevantSpend = round2(
    rows
      .filter((row) => row.relevance.verdict === "irrelevant")
      .reduce((total, row) => total + row.spend, 0),
  );
  const queryCampaignSpend = input.queryCampaignSpend ?? null;
  const belowThresholdSpend =
    queryCampaignSpend === null
      ? 0
      : round2(Math.max(queryCampaignSpend - totalSpend, 0));

  const money = (value: number) =>
    new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: input.currency,
      maximumFractionDigits: 2,
    }).format(value);

  const notes = [
    `Read from ${input.rows.length} stored query row(s) covering ${current.size} query and keyword pair(s).`,
    "Rows exclude Dynamic Search Ads queries and the queries Google withholds below its privacy threshold, so they do not add up to campaign spend.",
  ];
  if (queryCampaignSpend === null) {
    notes.push(
      "Search and Shopping campaign spend was not read, so the withheld-query gap is not reported.",
    );
  }
  if (!hasComparisonRows) {
    notes.push(
      "No stored rows in the comparison window, so no query carries a period-over-period change.",
    );
  }
  if (unmeasuredGroups > 0) {
    notes.push(
      `${unmeasuredGroups} query and keyword pair(s) holding ${money(unmeasuredSpend)} have no measured conversions, so they are marked rather than judged.`,
    );
  }
  if (totalSpend > 0) {
    notes.push(
      `${Math.round((irrelevantSpend / totalSpend) * 100)}% of the query spend shown sits on queries the rules flagged as the wrong intent. Every flag carries its reason — confirm before adding a negative.`,
    );
  }
  if (!input.campaignChannelTypes || input.campaignChannelTypes.size === 0) {
    notes.push(
      "No campaign attributes are stored yet, so the campaign column reads Unclassified.",
    );
  }

  return {
    platform: "google",
    dataOrigin: "platform",
    range: input.range,
    comparisonRange: input.comparisonRange,
    comparisonWindow: input.comparisonWindow,
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
    safeMessage: notes.join(" "),
  };
}
