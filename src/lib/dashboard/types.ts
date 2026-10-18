import type { AdvisoryBrief } from "@/lib/dashboard/advisory";
import type { MetaAudienceAnalysis } from "@/lib/dashboard/audience-meta";
import type { GoogleAudienceAnalysis } from "@/lib/dashboard/audience-google";
import type { BudgetPacingReport } from "@/lib/dashboard/budget";
import type { CampaignTypeAnalysis } from "@/lib/dashboard/campaign-types";
import type { VolumeConfidence } from "@/lib/dashboard/confidence";
import type { DeviceAnalysis } from "@/lib/dashboard/device";
import type { GeoAnalysis } from "@/lib/dashboard/geo/analysis";
import type { ImpressionShareReport } from "@/lib/dashboard/impression-share";
import type { SearchTermAnalysis } from "@/lib/dashboard/search-terms";
// Type-only, so the Platform import that points back here erases at build time
// and no runtime cycle is created.
import type { PendingPanel } from "@/lib/dashboard/sections";
import type { PerformanceSnapshot } from "@/lib/dashboard/snapshot-summary";

export type Platform = "all" | "meta" | "google";

export type WorklogPlatform =
  | Platform
  | "tiktok"
  | "ga4"
  | "bing"
  | "other";

export type DashboardDataMode = "mock" | "live";

export type DashboardStorageMode = "fixture" | "supabase";

export type MetricSourceConnector =
  | "mock"
  | "meta-direct-api"
  | "google-direct-api"
  | "meta-official-mcp"
  | "meta-community-mcp"
  | "meta-pipeboard"
  | "google-official-mcp"
  | "google-experimental-mcp"
  | "google-pipeboard";

export type DataStatus = "ready" | "partial" | "stale" | "blocked";

export type SyncJobStatus =
  | "queued"
  | "syncing"
  | "validating"
  | "succeeded"
  | "partial"
  | "failed";

export interface DateRange {
  start: string;
  end: string;
}

export type DataQualityIssueCode =
  | "no-data"
  | "platform-missing"
  | "missing-date"
  | "duplicate-row"
  | "currency-mismatch"
  | "timezone-mismatch"
  | "timezone-mismatch-bst"
  | "provisional-day"
  | "stale-sync";

export interface DataQualityIssue {
  code: DataQualityIssueCode;
  severity: "blocking" | "warning";
  platform: Platform;
  safeMessage: string;
  dates: string[];
}

/**
 * How the account timezones in one scope line up, judged from the real UTC
 * offsets on every day of the period rather than from the zone names.
 *
 * - `single`: one timezone, nothing to reconcile.
 * - `equivalent`: different names, identical day boundaries for the whole
 *   period (for example `Etc/GMT` and `Europe/London` in winter).
 * - `uk-summer-time-offset`: the UK GMT/BST pair, one hour apart on the dates
 *   listed in `offsetDates`. Published with a disclaimer, never silently.
 * - `incompatible`: any other mix. The gate blocks publication.
 */
export interface TimezoneAlignment {
  status: "single" | "equivalent" | "uk-summer-time-offset" | "incompatible";
  /** Distinct timezone per platform, sorted by platform then timezone. */
  platformTimezones: {
    platform: Exclude<Platform, "all">;
    timezone: string;
  }[];
  /**
   * Widest gap between day boundaries across the period, in minutes. Null
   * when a timezone could not be resolved, which always blocks.
   */
  maxOffsetMinutes: number | null;
  /** Days whose boundaries differ between the accounts. */
  offsetDates: string[];
}

export interface PlatformCoverage {
  platform: Exclude<Platform, "all">;
  expectedDays: number;
  coveredDays: number;
  coveragePercent: number;
  missingDates: string[];
  status: "ready" | "partial" | "missing";
}

export interface DataQualityReport {
  expectedDays: number;
  expectedRowCount: number;
  coveragePercent: number;
  platformCoverage: PlatformCoverage[];
  missingDates: string[];
  duplicateKeys: string[];
  provisionalDates: string[];
  currentDayIncluded: boolean;
  lastSyncedAt: string | null;
  status: DataStatus;
  summaryBlocked: boolean;
  issues: DataQualityIssue[];
  /** Carried to the snapshot so the UI can show the timezone disclaimer. */
  timezoneAlignment: TimezoneAlignment;
}

/**
 * Reporting currency is native per account and is never converted. The 30
 * acquisition guardrail applies in whichever currency the account reports, so
 * cost figures from different currencies must never be aggregated.
 */
export type Currency = "USD" | "IDR" | "SGD" | "MYR" | "GBP" | "EUR";

export type GuardrailStatus = "pass" | "near" | "breach" | "unavailable";

export interface GuardrailCheck {
  metric: "costPerPurchase" | "costPerRegistration" | "conversionRate";
  label: string;
  shortLabel: string;
  value: number | null;
  target: number;
  unit: "currency" | "percent";
  /** "lower" for cost targets, "higher" for the conversion-rate floor. */
  favorableDirection: "lower" | "higher";
  currency: Currency;
  status: GuardrailStatus;
  safeMessage: string;
}

export interface AcquisitionGuardrailReport {
  /** Kept as the headline cost-per-order target for compatibility. */
  threshold: number;
  targets: {
    costPerOrder: number;
    costPerAcquisition: number;
    conversionRate: number;
  };
  currency: Currency;
  /** False when the scope mixes currencies, which forbids cost aggregation. */
  costAggregationAllowed: boolean;
  status: GuardrailStatus;
  checks: GuardrailCheck[];
  safeMessage: string;
}

export interface DailyMetric {
  date: string;
  clientId: string;
  accountId: string;
  platform: Exclude<Platform, "all">;
  currency: Currency;
  accountTimezone: string;
  spend: number;
  impressions: number;
  clicks: number;
  /**
   * Visits where the destination page loaded, or null when the source did not
   * measure it that day. Meta derives this from its pixel on every account; a
   * Google account only reports it once a page-view conversion action is
   * mapped and firing, and several accounts have none. Null is not 0: a zero
   * asserts nobody arrived, which for an account taking orders is a false
   * finding rather than a missing one.
   */
  landingPageViews: number | null;
  /**
   * Visits where someone stayed past the account's dwell threshold. Google
   * carries it through a dwell-time conversion action on the site tag; Meta
   * has no equivalent. Distinct from a landing page view, which only says the
   * page loaded.
   *
   * Follows the same convention as `orderConversionValue`: null when the
   * action is mapped but measured nothing, undefined when the source never
   * reports it at all. `sumMeasured` skips both, so neither becomes a zero.
   */
  engagedVisits?: number | null;
  /**
   * Baskets started. Google reports it through an ADD_TO_CART conversion
   * action, Meta through its pixel's add_to_cart. Null when mapped but
   * unmeasured, undefined when the source does not report it.
   */
  addToBaskets?: number | null;
  registrations: number;
  purchases: number;
  platformConversionValue: number;
  actualPurchaseRevenue: number;
  sourceConnector: MetricSourceConnector;
  sourceQueryVersion: string;
  syncedAt: string;
  isProvisional: boolean;
  /**
   * Entity identity for rows below account level. Account rows leave these
   * unset so the dashboard contract is unchanged; campaign rows carry the
   * platform campaign id and its name at sync time. `daily_metrics` stores
   * both levels and `readStoredMetrics` still reads only `entity_level`
   * `account`, so a campaign breakdown can never double count a KPI.
   */
  entityLevel?: "account" | "campaign";
  entityKey?: string;
  entityName?: string;
  /** Meta only: people reached that day, already deduplicated by the platform. */
  reach?: number;
  /** Google only: search impression share and where the rest was lost, 0 to 1. */
  searchImpressionShare?: number;
  impressionShareLostToRank?: number;
  impressionShareLostToBudget?: number;
  /**
   * Value of the mapped purchase action only — the e-commerce ROAS numerator.
   * Null when no purchase action is mapped; undefined when the source never
   * reports it (fixtures, Meta). Mirrors `platformConversionValue` today and is
   * carried separately so the two posts can never be blended by accident.
   */
  orderConversionValue?: number | null;
  /**
   * Value of the mapped registration action only — the assigned B2B lead
   * value. Never part of any ROAS. Null when no registration action is mapped.
   */
  registrationLeadValue?: number | null;
}

export interface MetricTotals {
  spend: number;
  impressions: number;
  clicks: number;
  /**
   * Null when no row in scope measured it. Every ratio built on it is null
   * too, so an unmapped account reports a blind spot rather than a collapse.
   */
  landingPageViews: number | null;
  /** Null when no row in scope measured it. Google only. */
  engagedVisits: number | null;
  /** Null when no row in scope measured it. */
  addToBaskets: number | null;
  registrations: number;
  purchases: number;
  platformConversionValue: number;
  actualPurchaseRevenue: number;
  /**
   * Mapped purchase-action value only. Null when no row in scope measured it.
   * ROAS keeps reading order value; this total exists so the split is explicit.
   */
  orderConversionValue: number | null;
  /**
   * Mapped registration-action value only — assigned B2B lead value. Null when
   * no row in scope measured it. Deliberately feeds no ROAS or MER figure.
   */
  registrationLeadValue: number | null;
  /** Registrations plus purchases, matching the all-conversions contract. */
  allConversions: number;
  allConversionRate: number | null;
  /** Meta only. Reach is not additive across days, so this is a daily average. */
  averageDailyReach: number | null;
  averageDailyFrequency: number | null;
  /** Google only, weighted by impressions. */
  impressionShare: number | null;
  impressionShareLostToRank: number | null;
  impressionShareLostToBudget: number | null;
  /** Platform-reported value divided by the revenue actually recorded. */
  platformValueRatio: number | null;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  costPerLandingPageView: number | null;
  costPerAddToBasket: number | null;
  costPerRegistration: number | null;
  costPerPurchase: number | null;
  clickToLpvRate: number | null;
  /** Page views that went on to start a basket. Null unless both were measured. */
  lpvToBasketRate: number | null;
  lpvToRegistrationRate: number | null;
  registrationToPurchaseRate: number | null;
  clickToPurchaseRate: number | null;
  averageOrderValue: number | null;
  actualRevenueRoas: number | null;
  platformRoas: number | null;
}

/**
 * Scorecard stages follow the customer journey so a metric is read next to the
 * step it actually describes, not in an arbitrary KPI grid.
 */
export type JourneyStage =
  | "investment"
  | "reach"
  | "engagement"
  | "consideration"
  | "acquisition"
  | "revenue";

export interface JourneyStageDefinition {
  stage: JourneyStage;
  label: string;
  question: string;
}

export interface MetricCardData {
  key: string;
  stage: JourneyStage;
  label: string;
  value: number | null;
  previousValue: number | null;
  unit: "currency" | "count" | "ratio" | "percent";
  favorableDirection: "higher" | "lower" | "neutral";
  evidenceId: string;
  /** Platform this metric exists on, or null when both report it. */
  platformScope: Exclude<Platform, "all"> | null;
  /**
   * Whether the source measured this metric at all in the selected scope.
   * `value` is null in two unrelated cases — a quantity nobody measured, and a
   * ratio whose denominator was 0 — and a reader cannot tell those apart from
   * the number alone. This field carries the distinction so the card can say
   * "Not reported" instead of printing a figure that was never taken.
   */
  availability: "reported" | "not-reported";
  /** Set when the metric mixes two platforms that count differently. */
  mixedBasisWarning: string | null;
  /** Volume read for the conversion count behind this metric. */
  confidence: VolumeConfidence | null;
  confidenceMessage: string | null;
}

export interface TrendPoint extends MetricTotals {
  date: string;
  metaSpend: number;
  googleSpend: number;
  metaPurchaseValue: number;
  googlePurchaseValue: number;
}

export interface PlatformBreakdown {
  platform: Exclude<Platform, "all">;
  totals: MetricTotals;
  comparisonTotals: MetricTotals;
}

export interface WorklogEntry {
  id: string;
  occurredAt: string;
  platform: WorklogPlatform;
  actionType: string;
  actionSummary: string;
  reasonOrHypothesis: string;
  status: "approved";
}

export interface DashboardSnapshot {
  mode: DashboardDataMode;
  storage: DashboardStorageMode;
  account: {
    id: string;
    name: string;
    currency: Currency;
    timezone: string;
  };
  selectedRange: DateRange;
  /**
   * False when the reader switched comparison off. Every period-over-period
   * read-out is then withheld rather than shown against a baseline nobody
   * asked for; `comparisonRange` still names the window the rule-based
   * panels fall back on, and the UI says so.
   */
  comparisonEnabled: boolean;
  comparisonRange: DateRange;
  comparisonBasis: {
    label: string;
    activeDays: number;
    comparisonDays: number;
    /** True when additive comparison totals are scaled to the active duration. */
    normalisedToActiveDuration: boolean;
  };
  selectedPlatform: Platform;
  generatedAt: string;
  lastSuccessfulSync: string | null;
  dataStatus: DataStatus;
  dataHealth: {
    coveragePercent: number;
    mappingStatus: "fixture-only" | "approved" | "unverified";
    reconciliationStatus: "not-applicable" | "verified" | "unverified";
    currentDayIncluded: boolean;
    summaryBlocked: boolean;
  };
  quality: DataQualityReport;
  guardrail: AcquisitionGuardrailReport;
  snapshotSummary: PerformanceSnapshot;
  /** Insight and recommendation panels; rule-written until an agent runs. */
  advisory: AdvisoryBrief;
  /** Google-only diagnostic; null when the filter excludes Google. */
  impressionShare: ImpressionShareReport | null;
  /** Formal auction diagnostics contract with traffic lights and provenance. */
  auctionDiagnostics?: import("@/lib/ui-contract").AuctionDiagnostics | null;
  budgetPacing: BudgetPacingReport;
  /** Null in live mode: the figures are generated, not read from a platform. */
  geo: GeoAnalysis | null;
  /** Google-only device cut; null when the filter excludes Google. */
  devices: DeviceAnalysis | null;
  /** Formal device breakdown contract with CTV anomaly detection. */
  deviceBreakdown?: import("@/lib/ui-contract").DevicePerformanceBreakdown | null;
  /**
   * Device cut for the selected comparison window. Null when comparison is
   * off, Google is excluded, or no comparable Google rows are available.
   */
  comparisonDevices: DeviceAnalysis | null;
  /** Google-only campaign-type cut; null when the filter excludes Google. */
  campaignTypes: CampaignTypeAnalysis | null;
  /** Meta-only audience cut; null unless the filter is Meta alone. */
  audience: MetaAudienceAnalysis | null;
  /** Google-only audience segment cut; null when the filter excludes Google. */
  audienceSegments: GoogleAudienceAnalysis | null;
  /** Google-only search terms and keywords; null when Google is excluded. */
  searchTerms: SearchTermAnalysis | null;
  /** Meta-only creative fatigue radar; null unless Meta alone. */
  creativeFatigue: MetaCreativeFatigueAnalysis | null;
  /** Meta-only placement performance breakdown; null unless Meta alone. */
  placementAnalysis: MetaPlacementAnalysis | null;
  /** Google-only intent tier breakdown; null when Google is excluded. */
  intentAnalysis: GoogleIntentAnalysis | null;
  /** Google-only wasted spend impact and negative keyword center; null when Google is excluded. */
  wastedSpendSummary: GoogleWastedSpendSummary | null;
  /** Google-only match type drift monitor; null when Google is excluded. */
  matchTypeDrift: GoogleMatchTypeDriftSummary | null;
  /**
   * Cross-channel Blended MER and attribution reconciliation. Null in live
   * mode: store net sales are still modelled from ad spend rather than read
   * from the store, and the reconciliation note states them as the store's own figures.
   */
  blendedMer: BlendedMerSummary | null;
  /** RFM Store Cohort to Paid Ads bridge. Null in live mode; cohorts are generated. */
  rfmAudienceBridge: RfmPaidAudienceBridge | null;
  /** Cross-platform budget advisor. Null in live mode; it is driven by a fixed ROAS. */
  budgetOpportunity: BudgetOpportunityAdvisor | null;
  /**
   * Panels withheld in live mode because their figures are generated. Empty in
   * mock mode, where those panels render behind a synthetic-mockup notice.
   */
  pendingPanels: PendingPanel[];
  /** Non-null when the scope mixes platforms with different conversion bases. */
  conversionCaveat: string | null;
  cards: MetricCardData[];
  totals: MetricTotals;
  comparisonTotals: MetricTotals;
  trend: TrendPoint[];
  platformBreakdown: PlatformBreakdown[];
  worklog: WorklogEntry[];
  summary: {
    status: "preview";
    whatHappened: string[];
    likelyDrivers: string[];
    risks: string[];
    recommendedNextActions: string[];
    confidence: "low" | "medium" | "high";
    metricEvidenceIds: string[];
    worklogEvidenceIds: string[];
    dataGaps: string[];
  };
}

/* =========================================================================
   PPC ADVANCED DIAGNOSTICS & OPERATIONAL RADAR TYPES
   ========================================================================= */

export type CreativeFatigueStatus = "healthy" | "warning" | "critical";

export interface MetaCreativeHealthRow {
  adId: string;
  adName: string;
  format: "static" | "carousel" | "video_reels";
  /** Active delivery days inside the selected inclusive reporting period. */
  daysActive: number;
  spend: number;
  impressions: number;
  frequency: number;
  ctrCurrent: number;
  ctrDeltaVs7d: number;
  cpmCurrent: number;
  cpmDeltaVs7d: number;
  purchases: number;
  costPerPurchase: number | null;
  roas: number | null;
  fatigueStatus: CreativeFatigueStatus;
  recommendedAction: string;
}

export interface MetaCreativeFatigueAnalysis {
  activeAdsCount: number;
  healthyCount: number;
  warningCount: number;
  criticalCount: number;
  adCeilingRecommended: number;
  ads: MetaCreativeHealthRow[];
  videoEngagement: {
    hookRate: number; // 3-sec view rate %
    holdRate: number; // ThruPlay rate %
    averageWatchTimeSec: number;
    hookVerdict: "strong" | "average" | "needs_attention";
    holdVerdict: "strong" | "average" | "needs_attention";
    diagnosticNote: string;
  };
}

export type PlacementWasteStatus = "optimal" | "high_bounce_waste" | "underfunded";

export interface MetaPlacementBreakdownRow {
  placement: "ig_feed" | "ig_reels" | "ig_stories" | "fb_feed" | "fb_stories" | "audience_network";
  label: string;
  spend: number;
  spendSharePercent: number;
  clicks: number;
  cpc: number;
  ctr: number;
  purchases: number;
  cpa: number | null;
  roas: number | null;
  wasteStatus: PlacementWasteStatus;
}

export interface MetaPlacementAnalysis {
  placements: MetaPlacementBreakdownRow[];
  flaggedWasteAmount: number;
  topPerformingPlacement: string;
  recommendation: string;
}

/**
 * The ladder is non-brand by definition, so brand is not one of its rungs. It
 * used to be: the `competitor` key held brand queries under a competitor label,
 * which both mislabelled them and left brand spend inside the denominator of
 * "high intent share". Brand is now reported beside the ladder instead.
 *
 * `unclassified` is a rung because the spend behind an unmatched query is real.
 * Folding it into a tier turned "no rule fired" into a finding.
 */
export type IntentTierKey =
  | "high_intent_category"
  | "problem_aware"
  | "unclassified_waste"
  | "unclassified";

export interface GoogleIntentTierRow {
  tier: IntentTierKey;
  label: string;
  description: string;
  spend: number;
  spendSharePercent: number;
  clicks: number;
  /** Null when the tier took no clicks: no clicks is not a CPC of zero. */
  cpc: number | null;
  /** Null when the conversion pull did not land for these queries. */
  purchases: number | null;
  cpa: number | null;
  roas: number | null;
  topSampleQueries: string[];
}

export interface GoogleIntentAnalysis {
  tiers: GoogleIntentTierRow[];
  /** Share of non-brand spend on the top rung. Null when there is none to divide. */
  highIntentSharePercent: number | null;
  /** Queries the rules actually matched, as a share of non-brand spend. */
  classifiedSharePercent: number;
  /** Brand spend, held outside the ladder. */
  brandSpend: number;
  /** Brand spend as a share of all Search spend read, ladder included. */
  brandSharePercent: number;
  /** Distinct queries behind the ladder, brand excluded. */
  queryCount: number;
  strategicNote: string;
}

export interface GoogleNegativeRecommendation {
  query: string;
  reason: string;
  spendWasted: number;
  clicks: number;
  suggestedExact: string;
  suggestedPhrase: string;
}

/**
 * How much of the spend could be judged at all.
 *
 * `none` and `complete` both produce zero findings, and the difference between
 * them is the difference between "nothing is leaking" and "nothing could be
 * checked". The analyzer has always computed it; the summary used to drop it,
 * so an account whose conversion pull failed was shown a clean bill of health.
 */
export type WasteCoverage = "complete" | "partial" | "none";

export interface GoogleWastedSpendSummary {
  totalWastedAmount: number;
  wastedSpendPercent: number;
  monthlyProjectedSavings: number;
  flaggedQueryCount: number;
  /** All Search spend the query report covered. */
  spendAnalyzed: number;
  /** The part of it whose conversions were measured, and so could be judged. */
  measuredSpend: number;
  /** The rest: spend that cannot be called wasted or safe either way. */
  unmeasuredConversionSpend: number;
  coverage: WasteCoverage;
  recommendations: GoogleNegativeRecommendation[];
}

export interface GoogleMatchTypeDriftSummary {
  exactSpend: number;
  exactSharePercent: number;
  phraseSpend: number;
  phraseSharePercent: number;
  broadSpend: number;
  broadSharePercent: number;
  /**
   * Null when no query carried a scoreable keyword. It used to fall to zero,
   * which scored below the "tight" boundary and published an absence of data
   * as a green verdict.
   */
  driftIndexPercent: number | null;
  driftVerdict: "tight" | "moderate_drift" | "high_drift" | "insufficient_data";
  driftNote: string;
}

export interface BlendedMerSummary {
  storeNetSales: number;
  totalAdSpend: number;
  blendedMer: number;
  blendedCpa: number;
  realStoreOrders: number;
  claimedPlatformOrders: number;
  attributionOverlapPercent: number;
  overlapOrdersCount: number;
  merStatus: "scaling_ready" | "profitable_hold" | "underperforming";
  reconciliationNote: string;
}

export interface RfmAudienceActionCard {
  id: string;
  title: string;
  targetPlatform: "meta_custom_audience" | "meta_lookalike" | "google_customer_match" | "negative_exclusion";
  cohortLabel: string;
  customerCount: number;
  strategicPurpose: string;
  recommendedBudgetSplit: string;
  exportFileName: string;
}

export interface RfmPaidAudienceBridge {
  cards: RfmAudienceActionCard[];
  totalActionableAccounts: number;
}

export interface BudgetOpportunityAdvisor {
  status: "opportunity_found" | "balanced" | "constrained";
  recommendedShiftPercent: number;
  fromChannel: string;
  toChannel: string;
  estimatedWeeklyRevenueUplift: number;
  rationale: string;
}

export interface SyncJob {
  id: string;
  status: SyncJobStatus;
  requestedRange: DateRange;
  platforms: Exclude<Platform, "all">[];
  createdAt: string;
  updatedAt: string;
  safeMessage: string;
}
