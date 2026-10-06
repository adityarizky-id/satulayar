import type { Currency, DailyMetric, DateRange } from "@/lib/dashboard/types";

/**
 * Google campaign types, carrying the role each one plays in the account.
 *
 * An account review has to be explicit that campaigns with different roles
 * must not be compared on one metric without context: brand search buys demand
 * that already exists, Display creates it. So every row here carries its role,
 * and the verdict rules below only judge a row against the cost target when
 * that role is actually accountable for a direct order.
 */
export type CampaignTypeKey =
  | "searchBrand"
  | "searchNonBrand"
  | "shopping"
  | "performanceMax"
  | "display"
  | "demandGen"
  | "video"
  // Live only. A channel type Google reports that this file does not map yet
  // lands here instead of being dropped, so the table still reconciles to
  // account spend. Silently discarding it would understate the account.
  | "other";

export type CampaignRole =
  | "brand-capture"
  | "high-intent-acquisition"
  | "product-acquisition"
  | "demand-creation"
  | "remarketing"
  | "unclassified";

export const CAMPAIGN_ROLE_LABELS: Record<CampaignRole, string> = {
  "brand-capture": "Brand capture",
  "high-intent-acquisition": "High-intent acquisition",
  "product-acquisition": "Product acquisition",
  "demand-creation": "Demand creation",
  remarketing: "Remarketing",
  unclassified: "Unclassified",
};

/**
 * Roles judged directly on cost per order. Demand creation and remarketing are
 * deliberately absent: their contribution is assisted, and holding them to the
 * same target is how a working upper-funnel campaign gets killed.
 */
const DIRECT_RESPONSE_ROLES: readonly CampaignRole[] = [
  "brand-capture",
  "high-intent-acquisition",
  "product-acquisition",
];

export function isDirectResponseRole(role: CampaignRole): boolean {
  return DIRECT_RESPONSE_ROLES.includes(role);
}

export interface CampaignTypeDefinition {
  key: CampaignTypeKey;
  label: string;
  /** Google's `campaign.advertising_channel_type`, for the live mapping. */
  channelType: string;
  role: CampaignRole;
}

export const CAMPAIGN_TYPES: CampaignTypeDefinition[] = [
  {
    key: "searchBrand",
    label: "Search · brand",
    channelType: "SEARCH",
    role: "brand-capture",
  },
  {
    key: "searchNonBrand",
    label: "Search · non-brand",
    channelType: "SEARCH",
    role: "high-intent-acquisition",
  },
  {
    key: "shopping",
    label: "Shopping",
    channelType: "SHOPPING",
    role: "product-acquisition",
  },
  {
    key: "performanceMax",
    label: "Performance Max",
    channelType: "PERFORMANCE_MAX",
    role: "product-acquisition",
  },
  {
    key: "display",
    label: "Display",
    channelType: "DISPLAY",
    role: "demand-creation",
  },
  {
    key: "demandGen",
    label: "Demand Gen",
    channelType: "DEMAND_GEN",
    role: "demand-creation",
  },
  {
    key: "video",
    label: "Video",
    channelType: "VIDEO",
    role: "demand-creation",
  },
];

export interface AdGroupRow {
  id: string;
  name: string;
  /** Performance Max reports asset groups; every other supported channel reports ad groups. */
  entityLevel: "ad_group" | "asset_group";
  campaignType: CampaignTypeKey;
  /** Google's campaign id is the identity; the name is only a label. */
  campaignId: string;
  campaignName: string;
  status: "enabled" | "paused";
  spend: number;
  impressions: number;
  clicks: number;
  registrations: number;
  purchases: number;
  purchaseValue: number;
  ctr: number | null;
  cpc: number | null;
  costPerPurchase: number | null;
  costPerRegistration: number | null;
  returnOnAdSpend: number | null;
  /** Conversion measurement basis must stay visible because asset groups cannot be action-filtered. */
  conversionBasis: "filtered" | "google-total" | "unavailable";
  previous: CampaignPerformance | null;
}

export interface CampaignPerformance {
  spend: number;
  purchases: number;
  purchaseValue: number;
  costPerPurchase: number | null;
  returnOnAdSpend: number | null;
}

export interface CampaignTypeRow {
  key: CampaignTypeKey;
  label: string;
  role: CampaignRole;
  roleLabel: string;
  channelType: string;
  campaigns: number;
  adGroups: number;
  spend: number;
  impressions: number;
  clicks: number;
  registrations: number;
  purchases: number;
  purchaseValue: number;
  ctr: number | null;
  cpc: number | null;
  costPerPurchase: number | null;
  costPerRegistration: number | null;
  returnOnAdSpend: number | null;
  spendShare: number;
  purchaseShare: number;
  /** Purchase share minus spend share, in points. */
  efficiencyGap: number;
  /** False for roles whose contribution is assisted rather than direct. */
  judgedOnCostPerOrder: boolean;
  /**
   * The real campaigns behind this row, present only on the live path. When it
   * is set the drill-down must use it: the generated campaign names would
   * otherwise be shown underneath real money.
   */
  campaignRows?: CampaignRow[];
  previous: CampaignPerformance | null;
}

export interface CampaignTypeAnalysis {
  platform: "google";
  range: DateRange;
  currency: Currency;
  rows: CampaignTypeRow[];
  totals: {
    spend: number;
    registrations: number;
    purchases: number;
    purchaseValue: number;
  };
  safeMessage: string;
  /**
   * Where the rows came from. `synthetic-illustration` means account totals
   * split by fixed shares with invented campaign names; the section must say
   * so, because a reader cannot tell modelled rows from real ones by looking.
   */
  dataOrigin: "synthetic-illustration" | "platform";
  /** Null means comparison is switched off or no baseline rows were available. */
  comparisonRange: DateRange | null;
}

/** Shape constants: share of Google spend and relative efficiency per type. */
interface CampaignTypeShape {
  key: CampaignTypeKey;
  spendShare: number;
  clickShare: number;
  impressionShare: number;
  /** Cost per order relative to the account, where 1 is the account average. */
  costIndex: number;
  registrationsPerPurchase: number;
  averageOrderValueIndex: number;
  campaigns: number;
  adGroupsPerCampaign: number;
}

const SHAPES: CampaignTypeShape[] = [
  {
    key: "searchBrand",
    spendShare: 0.11,
    clickShare: 0.14,
    impressionShare: 0.08,
    costIndex: 0.42,
    registrationsPerPurchase: 2.6,
    averageOrderValueIndex: 1.05,
    campaigns: 1,
    adGroupsPerCampaign: 3,
  },
  {
    key: "searchNonBrand",
    spendShare: 0.29,
    clickShare: 0.27,
    impressionShare: 0.18,
    costIndex: 1.12,
    registrationsPerPurchase: 4.1,
    averageOrderValueIndex: 0.96,
    campaigns: 3,
    adGroupsPerCampaign: 4,
  },
  {
    key: "shopping",
    spendShare: 0.14,
    clickShare: 0.16,
    impressionShare: 0.15,
    costIndex: 0.88,
    registrationsPerPurchase: 2.2,
    averageOrderValueIndex: 1.02,
    campaigns: 2,
    adGroupsPerCampaign: 2,
  },
  {
    key: "performanceMax",
    spendShare: 0.28,
    clickShare: 0.24,
    impressionShare: 0.29,
    costIndex: 0.95,
    registrationsPerPurchase: 3.1,
    averageOrderValueIndex: 1,
    campaigns: 2,
    adGroupsPerCampaign: 3,
  },
  {
    key: "display",
    spendShare: 0.09,
    clickShare: 0.11,
    impressionShare: 0.19,
    costIndex: 2.35,
    registrationsPerPurchase: 6.4,
    averageOrderValueIndex: 0.82,
    campaigns: 2,
    adGroupsPerCampaign: 3,
  },
  {
    key: "demandGen",
    spendShare: 0.06,
    clickShare: 0.06,
    impressionShare: 0.08,
    costIndex: 2.1,
    registrationsPerPurchase: 5.5,
    averageOrderValueIndex: 0.88,
    campaigns: 1,
    adGroupsPerCampaign: 2,
  },
  {
    key: "video",
    spendShare: 0.03,
    clickShare: 0.02,
    impressionShare: 0.03,
    costIndex: 3.4,
    registrationsPerPurchase: 8.2,
    averageOrderValueIndex: 0.79,
    campaigns: 1,
    adGroupsPerCampaign: 2,
  },
];

/**
 * One campaign type routinely holds more than one campaign — two Search
 * campaigns split by market, or a core and a seasonal PMax. Rolling them into
 * one type row hides the case where one is healthy and the other is bleeding,
 * so the drill-down goes type → campaign → ad group.
 */
const CAMPAIGN_NAMES: Partial<Record<CampaignTypeKey, string[]>> = {
  searchBrand: ["ID | Brand"],
  searchNonBrand: [
    "ID | Non-brand | Core",
    "ID | Non-brand | Seasonal",
    "MY | Non-brand",
  ],
  shopping: ["ID | Shopping | All products", "ID | Shopping | Best sellers"],
  performanceMax: ["ID | PMax | Core catalogue", "ID | PMax | Clearance"],
  display: ["ID | Display | Remarketing", "ID | Display | Prospecting"],
  demandGen: ["ID | Demand Gen"],
  video: ["ID | Video | Brand story"],
};

const AD_GROUP_NAMES: Partial<Record<CampaignTypeKey, string[]>> = {
  searchBrand: ["Brand · exact", "Brand · phrase", "Brand + misspellings"],
  searchNonBrand: [
    "Specialty coffee",
    "Batik & textiles",
    "Rattan & bamboo",
    "Generic · broad",
  ],
  shopping: ["All products", "Best sellers"],
  performanceMax: ["Core catalogue", "New arrivals", "Clearance"],
  display: ["Remarketing · 30d", "In-market · coffee", "Custom intent"],
  demandGen: ["Lookalike · buyers", "Interest · home decor"],
  video: ["Brand story", "Product demo"],
};

function hash(value: string): number {
  let result = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16_777_619);
  }
  return (result >>> 0) / 4_294_967_296;
}

function safeDivide(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export interface CampaignTypeInput {
  range: DateRange;
  currency: Currency;
  accountSlug: string;
  googleSpend: number;
  googleImpressions: number;
  googleClicks: number;
  googlePurchases: number;
  googleRegistrations: number;
  googlePurchaseValue: number;
}

export function buildCampaignTypeAnalysis(
  input: CampaignTypeInput,
): CampaignTypeAnalysis {
  // Orders are distributed by spend weighted with the inverse of each type's
  // cost index, so a type with a high cost index returns fewer orders for the
  // same money — which is what a cost index means.
  const weightTotal = SHAPES.reduce(
    (total, shape) => total + shape.spendShare / shape.costIndex,
    0,
  );

  const rows = SHAPES.map<CampaignTypeRow>((shape) => {
    const definition = CAMPAIGN_TYPES.find((item) => item.key === shape.key);
    if (!definition) throw new Error(`Unknown campaign type ${shape.key}`);

    const orderWeight =
      weightTotal === 0 ? 0 : shape.spendShare / shape.costIndex / weightTotal;
    const spend = round(input.googleSpend * shape.spendShare);
    const impressions = Math.round(
      input.googleImpressions * shape.impressionShare,
    );
    const clicks = Math.round(input.googleClicks * shape.clickShare);
    const purchases = Math.round(input.googlePurchases * orderWeight);
    const registrations = Math.round(
      Math.min(
        input.googleRegistrations,
        purchases * shape.registrationsPerPurchase,
      ),
    );
    const purchaseValue = round(
      input.googlePurchaseValue * orderWeight * shape.averageOrderValueIndex,
    );

    return {
      key: shape.key,
      label: definition.label,
      role: definition.role,
      roleLabel: CAMPAIGN_ROLE_LABELS[definition.role],
      channelType: definition.channelType,
      // Both counts have to match the lists the drill-down actually renders.
      campaigns: (CAMPAIGN_NAMES[shape.key] ?? []).length,
      adGroups: (AD_GROUP_NAMES[shape.key] ?? []).length,
      spend,
      impressions,
      clicks,
      registrations,
      purchases,
      purchaseValue,
      ctr: safeDivide(clicks, impressions),
      cpc: safeDivide(spend, clicks),
      costPerPurchase: safeDivide(spend, purchases),
      costPerRegistration: safeDivide(spend, registrations),
      returnOnAdSpend: safeDivide(purchaseValue, spend),
      spendShare: 0,
      purchaseShare: 0,
      efficiencyGap: 0,
      judgedOnCostPerOrder: isDirectResponseRole(definition.role),
      previous: null,
    };
  });

  const totalSpend = rows.reduce((total, row) => total + row.spend, 0);
  const totalPurchases = rows.reduce((total, row) => total + row.purchases, 0);

  const withShares = rows.map((row) => {
    const spendShare = totalSpend === 0 ? 0 : row.spend / totalSpend;
    const purchaseShare =
      totalPurchases === 0 ? 0 : row.purchases / totalPurchases;
    return {
      ...row,
      spendShare,
      purchaseShare,
      efficiencyGap: purchaseShare - spendShare,
    };
  });

  const upperFunnelSpend = withShares
    .filter((row) => !row.judgedOnCostPerOrder)
    .reduce((total, row) => total + row.spend, 0);

  return {
    platform: "google",
    dataOrigin: "synthetic-illustration",
    comparisonRange: null,
    range: input.range,
    currency: input.currency,
    rows: withShares.toSorted((left, right) => right.spend - left.spend),
    totals: {
      spend: round(totalSpend),
      registrations: rows.reduce((total, row) => total + row.registrations, 0),
      purchases: totalPurchases,
      purchaseValue: round(
        rows.reduce((total, row) => total + row.purchaseValue, 0),
      ),
    },
    safeMessage:
      totalSpend === 0
        ? "No Google spend in this period, so no campaign type can be judged."
        : `${Math.round((upperFunnelSpend / totalSpend) * 100)}% of Google spend sits in demand-creation types, whose contribution is assisted. They are shown separately rather than being held to the order target.`,
  };
}

/** Ad groups inside one campaign type, for the drill-down. */
export function buildAdGroups(
  type: CampaignTypeRow,
  accountSlug: string,
  range: DateRange,
): AdGroupRow[] {
  const names = AD_GROUP_NAMES[type.key] ?? [];
  const weights = names.map(
    (name, index) =>
      0.4 + hash(`${accountSlug}|${type.key}|${name}|${range.start}`) + index * 0.05,
  );
  const weightTotal = weights.reduce((total, weight) => total + weight, 0);

  return names
    .map((name, index) => {
      const weight = weightTotal === 0 ? 0 : weights[index] / weightTotal;
      const seed = hash(`${accountSlug}|${type.key}|${name}|efficiency`);
      const spend = round(type.spend * weight);
      const clicks = Math.round(type.clicks * weight);
      // Impressions carry their own tilt so click-through rate differs between
      // ad groups; splitting both on one weight made every CTR identical.
      const reachTilt = 0.7 + hash(`${accountSlug}|${type.key}|${name}|reach`) * 0.8;
      const impressions = Math.round(type.impressions * weight * reachTilt);
      // Ad groups inside a type vary either side of the type's own efficiency,
      // which is the whole reason to drill in.
      const efficiencySpread = 0.6 + seed * 0.9;
      const purchases = Math.max(
        0,
        Math.round(type.purchases * weight * efficiencySpread),
      );
      const registrations = Math.max(
        0,
        Math.round(type.registrations * weight * efficiencySpread),
      );
      const purchaseValue = round(type.purchaseValue * weight * efficiencySpread);

      // Ad groups are dealt round-robin across the campaigns of the type, so
      // every campaign owns at least one and the totals still reconcile.
      const campaignNames = CAMPAIGN_NAMES[type.key] ?? [type.label];
      const campaignIndex = index % campaignNames.length;

      return {
        id: `${type.key}-${index}`,
        name,
        entityLevel:
          type.key === "performanceMax"
            ? ("asset_group" as const)
            : ("ad_group" as const),
        campaignType: type.key,
        campaignId: `${type.key}-c${campaignIndex}`,
        campaignName: campaignNames[campaignIndex],
        status: seed < 0.12 ? ("paused" as const) : ("enabled" as const),
        spend,
        impressions,
        clicks,
        registrations,
        purchases,
        purchaseValue,
        ctr: safeDivide(clicks, impressions),
        cpc: safeDivide(spend, clicks),
        costPerPurchase: safeDivide(spend, purchases),
        costPerRegistration: safeDivide(spend, registrations),
        returnOnAdSpend: safeDivide(purchaseValue, spend),
        conversionBasis: "filtered" as const,
        previous: null,
      };
    })
    .toSorted((left, right) => right.spend - left.spend);
}

export interface CampaignRow {
  id: string;
  name: string;
  campaignType: CampaignTypeKey;
  /**
   * `unknown` is live-only, for a campaign whose attributes have not been
   * ingested yet. Defaulting an unknown status to "paused" would tell a reader
   * a running campaign is stopped, which is worse than saying nothing.
   */
  status: "enabled" | "paused" | "unknown";
  spend: number;
  impressions: number;
  clicks: number;
  registrations: number;
  purchases: number;
  purchaseValue: number;
  ctr: number | null;
  cpc: number | null;
  costPerPurchase: number | null;
  costPerRegistration: number | null;
  returnOnAdSpend: number | null;
  adGroups: AdGroupRow[];
  previous: CampaignPerformance | null;
}

/**
 * The campaigns inside one type, each aggregated from the ad groups it owns.
 * Building it this way means a campaign total is always the sum of its ad
 * groups, and the type total the sum of its campaigns — no third set of
 * numbers that can drift away from the other two.
 */
export function buildCampaigns(
  type: CampaignTypeRow,
  accountSlug: string,
  range: DateRange,
): CampaignRow[] {
  const adGroups = buildAdGroups(type, accountSlug, range);
  const byCampaign = new Map<string, AdGroupRow[]>();

  for (const group of adGroups) {
    const existing = byCampaign.get(group.campaignId);
    if (existing) existing.push(group);
    else byCampaign.set(group.campaignId, [group]);
  }

  return [...byCampaign.entries()]
    .map(([id, groups]) => {
      const sum = (read: (row: AdGroupRow) => number) =>
        groups.reduce((total, row) => total + read(row), 0);
      const spend = round(sum((row) => row.spend));
      const clicks = sum((row) => row.clicks);
      const impressions = sum((row) => row.impressions);
      const purchases = sum((row) => row.purchases);
      const registrations = sum((row) => row.registrations);
      const purchaseValue = round(sum((row) => row.purchaseValue));

      return {
        id,
        name: groups[0]?.campaignName ?? id,
        campaignType: type.key,
        // A campaign counts as paused only when nothing inside it can serve.
        status: groups.every((row) => row.status === "paused")
          ? ("paused" as const)
          : ("enabled" as const),
        spend,
        impressions,
        clicks,
        registrations,
        purchases,
        purchaseValue,
        ctr: safeDivide(clicks, impressions),
        cpc: safeDivide(spend, clicks),
        costPerPurchase: safeDivide(spend, purchases),
        costPerRegistration: safeDivide(spend, registrations),
        returnOnAdSpend: safeDivide(purchaseValue, spend),
        adGroups: groups.toSorted((left, right) => right.spend - left.spend),
        previous: null,
      };
    })
    .toSorted((left, right) => right.spend - left.spend);
}

// ---------------------------------------------------------------------------
// Live path: the same table, built from campaign rows Google actually returned.
// ---------------------------------------------------------------------------

/** Campaign attributes as stored in `ad_campaigns`. */
export interface CampaignAttribute {
  campaignKey: string;
  campaignName: string;
  /** Google `campaign.advertising_channel_type`, verbatim. */
  channelType: string;
  channelSubType: string | null;
  status: string;
}

/**
 * Google's channel type onto a dashboard row.
 *
 * SEARCH deliberately resolves to one row, not two. The synthetic table split
 * Search into brand and non-brand, but `advertising_channel_type` does not
 * carry that distinction — separating them needs the query and keyword report.
 * Inventing the split here would reintroduce the exact defect this path exists
 * to remove, so live Search stays whole and the message says why.
 */
const LIVE_CHANNEL_TYPE_MAP: Record<string, CampaignTypeKey> = {
  SEARCH: "searchNonBrand",
  SHOPPING: "shopping",
  PERFORMANCE_MAX: "performanceMax",
  DISPLAY: "display",
  DEMAND_GEN: "demandGen",
  DISCOVERY: "demandGen",
  VIDEO: "video",
};

const LIVE_ROW_LABELS: Partial<Record<CampaignTypeKey, string>> = {
  // Reads "Search", not "Search · non-brand": the brand split is not measured.
  searchNonBrand: "Search",
};

/**
 * The live label for one Google channel type, shared with any panel that has to
 * name the campaign a row ran under (the search-query section does).
 *
 * An unmapped channel type returns the platform's own string rather than a
 * guess, and an empty one returns "Unclassified" — the same wording the
 * campaign-type table uses when `ad_campaigns` has no attribute yet.
 */
export function liveCampaignTypeLabel(channelType: string): string {
  const trimmed = channelType.trim();
  if (!trimmed) return "Unclassified";
  const key = LIVE_CHANNEL_TYPE_MAP[trimmed];
  if (!key) return trimmed;
  return (
    LIVE_ROW_LABELS[key] ??
    CAMPAIGN_TYPES.find((entry) => entry.key === key)?.label ??
    trimmed
  );
}

export interface LiveCampaignTypeInput {
  /** Campaign-level rows for the period. Account-level rows must not be passed. */
  rows: readonly DailyMetric[];
  attributes: readonly CampaignAttribute[];
  range: DateRange;
  currency: Currency;
  /** Campaign rows from the comparison filter, already read at campaign grain. */
  comparisonRows?: readonly DailyMetric[];
  /** Stored ad-group and asset-group rows for the active period. */
  entityRows?: readonly CampaignEntityMetric[];
  /** Same entity grain for the selected comparison window. */
  comparisonEntityRows?: readonly CampaignEntityMetric[];
  comparisonRange?: DateRange | null;
}

export interface CampaignEntityMetric {
  date: string;
  entityLevel: "ad_group" | "asset_group";
  campaignKey: string;
  entityKey: string;
  entityName: string | null;
  status: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  registrations: number | null;
  purchases: number | null;
  orderConversionValue: number | null;
  conversionActionFiltered: boolean;
}

interface CampaignAccumulator {
  spend: number;
  impressions: number;
  clicks: number;
  registrations: number;
  purchases: number;
  purchaseValue: number;
}

function emptyAccumulator(): CampaignAccumulator {
  return {
    spend: 0,
    impressions: 0,
    clicks: 0,
    registrations: 0,
    purchases: 0,
    purchaseValue: 0,
  };
}

function performanceFromAccumulator(
  totals: CampaignAccumulator,
): CampaignPerformance {
  const spend = round(totals.spend);
  const purchaseValue = round(totals.purchaseValue);
  return {
    spend,
    purchases: totals.purchases,
    purchaseValue,
    costPerPurchase: safeDivide(spend, totals.purchases),
    returnOnAdSpend: safeDivide(purchaseValue, spend),
  };
}

function inclusiveDays(range: DateRange): number {
  const start = Date.parse(`${range.start}T00:00:00Z`);
  const end = Date.parse(`${range.end}T00:00:00Z`);
  return Math.floor((end - start) / 86_400_000) + 1;
}

function comparisonScale(
  range: DateRange,
  comparisonRange: DateRange | null | undefined,
): number {
  if (!comparisonRange) return 1;
  return inclusiveDays(range) / inclusiveDays(comparisonRange);
}

function aggregateCampaignMetrics(
  rows: readonly DailyMetric[],
  scale = 1,
): Map<string, CampaignAccumulator> {
  const totals = new Map<string, CampaignAccumulator>();
  for (const row of rows) {
    if (row.platform !== "google" || !row.entityKey) continue;
    const bucket = totals.get(row.entityKey) ?? emptyAccumulator();
    bucket.spend += row.spend * scale;
    bucket.impressions += row.impressions * scale;
    bucket.clicks += row.clicks * scale;
    bucket.registrations += row.registrations * scale;
    bucket.purchases += row.purchases * scale;
    bucket.purchaseValue += row.actualPurchaseRevenue * scale;
    totals.set(row.entityKey, bucket);
  }
  return totals;
}

interface EntityAccumulator extends CampaignAccumulator {
  entityLevel: "ad_group" | "asset_group";
  campaignKey: string;
  entityKey: string;
  entityName: string | null;
  status: string | null;
  hasConversions: boolean;
  conversionActionFiltered: boolean;
}

function aggregateEntityMetrics(
  rows: readonly CampaignEntityMetric[],
  scale = 1,
): Map<string, EntityAccumulator> {
  const totals = new Map<string, EntityAccumulator>();
  for (const row of rows) {
    const key = `${row.campaignKey}|${row.entityLevel}|${row.entityKey}`;
    const bucket = totals.get(key) ?? {
      ...emptyAccumulator(),
      entityLevel: row.entityLevel,
      campaignKey: row.campaignKey,
      entityKey: row.entityKey,
      entityName: row.entityName,
      status: row.status,
      hasConversions: false,
      conversionActionFiltered: row.conversionActionFiltered,
    };
    bucket.spend += row.spend * scale;
    bucket.impressions += row.impressions * scale;
    bucket.clicks += row.clicks * scale;
    bucket.registrations += (row.registrations ?? 0) * scale;
    bucket.purchases += (row.purchases ?? 0) * scale;
    bucket.purchaseValue += (row.orderConversionValue ?? 0) * scale;
    bucket.hasConversions ||= row.purchases !== null;
    bucket.conversionActionFiltered &&= row.conversionActionFiltered;
    if (row.entityName) bucket.entityName = row.entityName;
    if (row.status) bucket.status = row.status;
    totals.set(key, bucket);
  }
  return totals;
}

/**
 * Builds the campaign-type table from stored campaign rows.
 *
 * Returns null when there is nothing real to show, so the caller leaves the
 * pending placeholder in place rather than falling back to generated figures.
 */
export function buildCampaignTypeAnalysisFromRows(
  input: LiveCampaignTypeInput,
): CampaignTypeAnalysis | null {
  const googleRows = input.rows.filter(
    (row) => row.platform === "google" && row.entityKey,
  );
  if (googleRows.length === 0) return null;

  const scale = comparisonScale(input.range, input.comparisonRange);
  const comparisonCampaigns = aggregateCampaignMetrics(
    input.comparisonRows ?? [],
    scale,
  );
  const currentEntities = aggregateEntityMetrics(input.entityRows ?? []);
  const comparisonEntities = aggregateEntityMetrics(
    input.comparisonEntityRows ?? [],
    scale,
  );

  const attributeByKey = new Map(
    input.attributes.map((item) => [item.campaignKey, item]),
  );

  // Per campaign first, so the campaign count per row is a real count of
  // distinct campaigns rather than a count of daily rows.
  const perCampaign = aggregateCampaignMetrics(googleRows);

  // Campaign display names come from the metric rows themselves, so a campaign
  // still shows a name when `ad_campaigns` has not caught up with it.
  const nameByKey = new Map<string, string>();
  for (const row of googleRows) {
    const key = row.entityKey as string;
    if (row.entityName && !nameByKey.has(key)) nameByKey.set(key, row.entityName);
  }

  const byType = new Map<
    CampaignTypeKey,
    CampaignAccumulator & {
      campaigns: number;
      channelTypes: Set<string>;
      campaignRows: CampaignRow[];
    }
  >();
  let unmappedCampaigns = 0;

  for (const [campaignKey, totals] of perCampaign) {
    const attribute = attributeByKey.get(campaignKey);
    const channelType = attribute?.channelType ?? "";
    const typeKey = LIVE_CHANNEL_TYPE_MAP[channelType] ?? "other";
    if (typeKey === "other") unmappedCampaigns += 1;

    const bucket = byType.get(typeKey) ?? {
      ...emptyAccumulator(),
      campaigns: 0,
      channelTypes: new Set<string>(),
      campaignRows: [] as CampaignRow[],
    };

    const campaignSpend = round(totals.spend);
    const campaignValue = round(totals.purchaseValue);
    const entityRows = [...currentEntities.entries()]
      .filter(([, entity]) => entity.campaignKey === campaignKey)
      .map(([entityMapKey, entity]): AdGroupRow => {
        const entitySpend = round(entity.spend);
        const entityValue = round(entity.purchaseValue);
        const previousEntity = comparisonEntities.get(entityMapKey);
        return {
          id: entity.entityKey,
          name: entity.entityName ?? `${entity.entityLevel === "asset_group" ? "Asset" : "Ad"} group ${entity.entityKey}`,
          entityLevel: entity.entityLevel,
          campaignType: typeKey,
          campaignId: campaignKey,
          campaignName:
            attribute?.campaignName ??
            nameByKey.get(campaignKey) ??
            `Campaign ${campaignKey}`,
          status:
            entity.status?.toUpperCase() === "ENABLED" ? "enabled" : "paused",
          spend: entitySpend,
          impressions: Math.round(entity.impressions),
          clicks: Math.round(entity.clicks),
          registrations: entity.registrations,
          purchases: entity.purchases,
          purchaseValue: entityValue,
          ctr: safeDivide(entity.clicks, entity.impressions),
          cpc: safeDivide(entitySpend, entity.clicks),
          costPerPurchase: entity.hasConversions
            ? safeDivide(entitySpend, entity.purchases)
            : null,
          costPerRegistration: safeDivide(entitySpend, entity.registrations),
          returnOnAdSpend: entity.hasConversions
            ? safeDivide(entityValue, entitySpend)
            : null,
          conversionBasis: !entity.hasConversions
            ? "unavailable"
            : entity.conversionActionFiltered
              ? "filtered"
              : "google-total",
          previous: previousEntity
            ? performanceFromAccumulator(previousEntity)
            : null,
        };
      })
      .toSorted((left, right) => right.spend - left.spend);
    const previousCampaign = comparisonCampaigns.get(campaignKey);
    bucket.campaignRows.push({
      id: campaignKey,
      name:
        attribute?.campaignName ??
        nameByKey.get(campaignKey) ??
        `Campaign ${campaignKey}`,
      campaignType: typeKey,
      // Google reports many statuses; only ENABLED is running. With no stored
      // attribute at all the status is genuinely unknown, not paused.
      status: !attribute
        ? "unknown"
        : attribute.status.toUpperCase() === "ENABLED"
          ? "enabled"
          : "paused",
      spend: campaignSpend,
      impressions: totals.impressions,
      clicks: totals.clicks,
      registrations: totals.registrations,
      purchases: totals.purchases,
      purchaseValue: campaignValue,
      ctr: safeDivide(totals.clicks, totals.impressions),
      cpc: safeDivide(campaignSpend, totals.clicks),
      costPerPurchase: safeDivide(campaignSpend, totals.purchases),
      costPerRegistration: safeDivide(campaignSpend, totals.registrations),
      returnOnAdSpend: safeDivide(campaignValue, campaignSpend),
      adGroups: entityRows,
      previous: previousCampaign
        ? performanceFromAccumulator(previousCampaign)
        : null,
    });
    bucket.spend += totals.spend;
    bucket.impressions += totals.impressions;
    bucket.clicks += totals.clicks;
    bucket.registrations += totals.registrations;
    bucket.purchases += totals.purchases;
    bucket.purchaseValue += totals.purchaseValue;
    bucket.campaigns += 1;
    if (channelType) bucket.channelTypes.add(channelType);
    byType.set(typeKey, bucket);
  }

  const totalSpend = [...byType.values()].reduce(
    (total, item) => total + item.spend,
    0,
  );
  const totalPurchases = [...byType.values()].reduce(
    (total, item) => total + item.purchases,
    0,
  );

  const rows: CampaignTypeRow[] = [...byType.entries()].map(([key, item]) => {
    const definition = CAMPAIGN_TYPES.find((entry) => entry.key === key);
    const role: CampaignRole = definition?.role ?? "unclassified";
    const spend = round(item.spend);
    const purchaseValue = round(item.purchaseValue);
    const spendShare = totalSpend === 0 ? 0 : item.spend / totalSpend;
    const purchaseShare =
      totalPurchases === 0 ? 0 : item.purchases / totalPurchases;

    return {
      key,
      label:
        LIVE_ROW_LABELS[key] ??
        definition?.label ??
        ([...item.channelTypes].join(", ") || "Unmapped channel type"),
      role,
      roleLabel: CAMPAIGN_ROLE_LABELS[role],
      channelType:
        [...item.channelTypes].join(", ") || definition?.channelType || "",
      campaigns: item.campaigns,
      adGroups: item.campaignRows.reduce(
        (total, campaign) => total + campaign.adGroups.length,
        0,
      ),
      spend,
      impressions: item.impressions,
      clicks: item.clicks,
      registrations: item.registrations,
      purchases: item.purchases,
      purchaseValue,
      ctr: safeDivide(item.clicks, item.impressions),
      cpc: safeDivide(spend, item.clicks),
      costPerPurchase: safeDivide(spend, item.purchases),
      costPerRegistration: safeDivide(spend, item.registrations),
      returnOnAdSpend: safeDivide(purchaseValue, spend),
      spendShare,
      purchaseShare,
      efficiencyGap: purchaseShare - spendShare,
      judgedOnCostPerOrder: isDirectResponseRole(role),
      campaignRows: item.campaignRows.toSorted(
        (left, right) => right.spend - left.spend,
      ),
      previous: (() => {
        const totals = item.campaignRows.reduce<CampaignAccumulator>(
          (accumulator, campaign) => {
            if (!campaign.previous) return accumulator;
            accumulator.spend += campaign.previous.spend;
            accumulator.purchases += campaign.previous.purchases;
            accumulator.purchaseValue += campaign.previous.purchaseValue;
            return accumulator;
          },
          emptyAccumulator(),
        );
        return totals.spend > 0 || totals.purchases > 0
          ? performanceFromAccumulator(totals)
          : null;
      })(),
    };
  });

  const notes = [
    `Read from ${perCampaign.size} campaign(s) reported by Google Ads.`,
    "Search is shown whole: the channel type does not separate brand from non-brand.",
  ];
  if (unmappedCampaigns > 0) {
    notes.push(
      `${unmappedCampaigns} campaign(s) use a channel type this view does not map yet and are grouped under Unclassified, so the totals still reconcile to account spend.`,
    );
  }
  if (input.attributes.length === 0) {
    notes.push(
      "No campaign attributes are stored yet, so every campaign is Unclassified. Run a refresh to populate ad_campaigns.",
    );
  }
  const entityCount = [...currentEntities.values()].length;
  if (entityCount > 0) {
    const assetGroupCount = [...currentEntities.values()].filter(
      (row) => row.entityLevel === "asset_group",
    ).length;
    notes.push(
      `Drill-down includes ${entityCount - assetGroupCount} ad group(s) and ${assetGroupCount} Performance Max asset group(s).`,
    );
  } else {
    notes.push("No ad group or asset group rows are stored for this period yet.");
  }

  return {
    platform: "google",
    dataOrigin: "platform",
    comparisonRange:
      comparisonCampaigns.size > 0 ? (input.comparisonRange ?? null) : null,
    range: input.range,
    currency: input.currency,
    rows: rows.toSorted((left, right) => right.spend - left.spend),
    totals: {
      spend: round(totalSpend),
      registrations: rows.reduce((total, row) => total + row.registrations, 0),
      purchases: totalPurchases,
      purchaseValue: round(
        rows.reduce((total, row) => total + row.purchaseValue, 0),
      ),
    },
    safeMessage: notes.join(" "),
  };
}
