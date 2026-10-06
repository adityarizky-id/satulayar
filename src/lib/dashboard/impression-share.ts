import type { DateRange } from "@/lib/dashboard/types";

/**
 * Google-only auction diagnostic. Impression share explains why CPM moved: a
 * campaign loses the auction either on rank (ads or landing pages not good
 * enough) or on budget (money ran out), and the fix differs completely.
 *
 * Google reports three positions, not one:
 *  - overall      : the ad appeared anywhere on the page
 *  - top          : above the organic results
 *  - absolute top : the very first ad on the page
 *
 * Campaign names here are synthetic patterns, not real account structure.
 */
export type ImpressionShareTierKey = "overall" | "top" | "absoluteTop";

export const IMPRESSION_SHARE_TIERS: {
  key: ImpressionShareTierKey;
  label: string;
  question: string;
}[] = [
  {
    key: "overall",
    label: "Overall",
    question: "How often did the ad appear at all?",
  },
  {
    key: "top",
    label: "Top of page",
    question: "How often did it appear above the organic results?",
  },
  {
    key: "absoluteTop",
    label: "Absolute top",
    question: "How often was it the very first ad on the page?",
  },
];

/**
 * Google masks any share under 10% and prints "< 10%". Storing 0.1 for a
 * masked cell would be a fabricated number, so the value stays null and the
 * mask is carried explicitly. Nothing averages a masked cell.
 */
export interface MaskedShare {
  value: number | null;
  masked: boolean;
}

export interface ImpressionShareTier {
  key: ImpressionShareTierKey;
  label: string;
  share: MaskedShare;
  lostToRank: MaskedShare;
  lostToBudget: MaskedShare;
  /**
   * False when this tier was never asked of Google, which is a different
   * statement from `masked`. Masked means Google answered and withheld the
   * number because volume was too low; not ingested means nobody asked. The
   * period pull requests the three overall share metrics only, so the top and
   * absolute-top tiers arrive unreported rather than masked, and the panel must
   * not present the two the same way.
   */
  ingested: boolean;
}

export interface ImpressionShareRow {
  campaign: string;
  status: "active" | "paused";
  spend: number;
  tiers: Record<ImpressionShareTierKey, ImpressionShareTier>;
}

export interface ImpressionShareTierSummary {
  key: ImpressionShareTierKey;
  label: string;
  /** Spend-weighted across the campaigns Google actually reported. */
  averageShare: number | null;
  averageLostToRank: number | null;
  averageLostToBudget: number | null;
  maskedCampaigns: number;
  reportedCampaigns: number;
}

export interface ImpressionShareReport {
  platform: "google";
  range: DateRange;
  reportingFloor: number;
  rows: ImpressionShareRow[];
  tiers: ImpressionShareTierSummary[];
  safeMessage: string;
  /** Which lost bucket dominates, so the reader knows the lever to pull. */
  dominantLoss: "rank" | "budget" | "mixed";
  dominantLossMessage: string;
  /**
   * `measured` means Google answered for this exact window at period grain.
   * `modelled` means fixed campaign shapes, which is only fit for a fixtures
   * build: daily shares cannot be averaged back into a period figure, and on
   * a single account that approximation can land close to the true figure
   * and still be wrong.
   */
  basis: "measured" | "modelled";
}

const REPORTING_FLOOR = 0.1;

interface CampaignShape {
  campaign: string;
  status: "active" | "paused";
  spendShare: number;
  /** null means Google masked the share for that tier. */
  overall: { share: number | null; lostToRank: number };
  top: { share: number | null; lostToRank: number };
  absoluteTop: { share: number | null; lostToRank: number };
}

const CAMPAIGN_SHAPES: CampaignShape[] = [
  {
    campaign: "ID | Search | Coffee Core",
    status: "active",
    spendShare: 0.46,
    overall: { share: null, lostToRank: 0.6 },
    top: { share: null, lostToRank: 0.45 },
    absoluteTop: { share: null, lostToRank: 0.48 },
  },
  {
    campaign: "ID | Rattan",
    status: "paused",
    spendShare: 0.14,
    overall: { share: null, lostToRank: 0.32 },
    top: { share: null, lostToRank: 0.51 },
    absoluteTop: { share: null, lostToRank: 0.51 },
  },
  {
    campaign: "ID | Batik",
    status: "paused",
    spendShare: 0.11,
    overall: { share: 0.14, lostToRank: 0.44 },
    top: { share: null, lostToRank: 0.45 },
    absoluteTop: { share: null, lostToRank: 0.48 },
  },
  {
    campaign: "ID | DSA (Search)",
    status: "paused",
    spendShare: 0.1,
    overall: { share: 0.12, lostToRank: 0.35 },
    top: { share: null, lostToRank: 0.51 },
    absoluteTop: { share: null, lostToRank: 0.51 },
  },
  {
    campaign: "MY | Search | Coffee",
    status: "paused",
    spendShare: 0.11,
    overall: { share: null, lostToRank: 0.55 },
    top: { share: null, lostToRank: 0.45 },
    absoluteTop: { share: null, lostToRank: 0.48 },
  },
  {
    campaign: "ID | Jamu",
    status: "paused",
    spendShare: 0.08,
    overall: { share: 0.17, lostToRank: 0.52 },
    top: { share: 0.11, lostToRank: 0.45 },
    absoluteTop: { share: null, lostToRank: 0.5 },
  },
];

function maskedShare(value: number | null): MaskedShare {
  return value === null
    ? { value: null, masked: true }
    : { value: Math.round(value * 1000) / 1000, masked: false };
}

function buildTier(
  key: ImpressionShareTierKey,
  label: string,
  input: { share: number | null; lostToRank: number },
): ImpressionShareTier {
  // The three buckets are exhaustive, so budget takes whatever rank leaves.
  // With a masked share the remainder is unknown too, and stays masked.
  const lostToBudget =
    input.share === null
      ? null
      : Math.max(0, Math.round((1 - input.share - input.lostToRank) * 1000) / 1000);

  return {
    key,
    label,
    share: maskedShare(input.share),
    lostToRank: maskedShare(input.lostToRank),
    lostToBudget: maskedShare(lostToBudget),
    ingested: true,
  };
}

function weightedShare(
  rows: readonly { weight: number; share: MaskedShare }[],
): number | null {
  let weighted = 0;
  let weight = 0;

  for (const row of rows) {
    if (row.share.masked || row.share.value === null) continue;
    weighted += row.share.value * row.weight;
    weight += row.weight;
  }

  return weight === 0 ? null : weighted / weight;
}

export function buildImpressionShareReport(
  range: DateRange,
  googleSpend: number,
): ImpressionShareReport {
  const rows: ImpressionShareRow[] = CAMPAIGN_SHAPES.map((shape) => ({
    campaign: shape.campaign,
    status: shape.status,
    spend: Math.round(googleSpend * shape.spendShare * 100) / 100,
    tiers: {
      overall: buildTier("overall", "Overall", shape.overall),
      top: buildTier("top", "Top of page", shape.top),
      absoluteTop: buildTier("absoluteTop", "Absolute top", shape.absoluteTop),
    },
  }));

  return finaliseImpressionShareReport(rows, range, "modelled");
}

/**
 * Tier summaries, dominant loss and the read-out, shared by the modelled and
 * measured builders so the two cannot describe the same numbers differently.
 */
function finaliseImpressionShareReport(
  rows: ImpressionShareRow[],
  range: DateRange,
  basis: ImpressionShareReport["basis"],
): ImpressionShareReport {
  const tiers = IMPRESSION_SHARE_TIERS.map<ImpressionShareTierSummary>(
    (tier) => {
      const cells = rows
        .map((row) => ({
          weight: row.spend,
          tier: row.tiers[tier.key],
        }))
        // A tier nobody asked Google about contributes nothing to an average.
        // Counting it as masked would inflate the masked-campaign count and
        // read as "Google withheld this", which is a different claim.
        .filter((cell) => cell.tier.ingested);
      const reported = cells.filter((cell) => !cell.tier.share.masked);

      return {
        key: tier.key,
        label: tier.label,
        averageShare: weightedShare(
          cells.map((cell) => ({ weight: cell.weight, share: cell.tier.share })),
        ),
        averageLostToRank: weightedShare(
          cells.map((cell) => ({
            weight: cell.weight,
            share: cell.tier.lostToRank,
          })),
        ),
        averageLostToBudget: weightedShare(
          cells.map((cell) => ({
            weight: cell.weight,
            share: cell.tier.lostToBudget,
          })),
        ),
        maskedCampaigns: cells.length - reported.length,
        reportedCampaigns: reported.length,
      };
    },
  );

  const overall = tiers.find((tier) => tier.key === "overall");
  const rank = overall?.averageLostToRank ?? 0;
  const budget = overall?.averageLostToBudget ?? 0;
  const dominantLoss =
    Math.abs(rank - budget) < 0.08 ? "mixed" : rank > budget ? "rank" : "budget";
  const maskedOverall = overall?.maskedCampaigns ?? 0;

  return {
    platform: "google",
    range,
    reportingFloor: REPORTING_FLOOR,
    rows,
    tiers,
    safeMessage:
      maskedOverall > 0
        ? `${maskedOverall} of ${rows.length} campaigns sit under Google's ${Math.round(
            REPORTING_FLOOR * 100,
          )}% reporting floor. Those cells read "< ${Math.round(
            REPORTING_FLOOR * 100,
          )}%" and are excluded from every average rather than counted as ${Math.round(
            REPORTING_FLOOR * 100,
          )}%.`
        : "Every campaign reports a share above Google's masking threshold.",
    dominantLossMessage:
      dominantLoss === "rank"
        ? "Most of the lost share goes to rank, so more budget alone will not buy it back. Ad relevance, bids, and landing pages are the lever."
        : dominantLoss === "budget"
          ? "Most of the lost share goes to budget, so the auction is winnable and the cap is the constraint."
          : "Rank and budget cost a similar amount of share, so raising budget without fixing rank only buys part of it back.",
    dominantLoss,
    basis,
  };
}

/**
 * Impression share from stored period-grain rows.
 *
 * The period figure is asked of Google directly rather than rolled up from
 * daily values, because Google masks any share below 10% as 0.0999 and an
 * average over masked days is not the period figure. That approximation can
 * land close to the true figure — close enough
 * on rank to look right, which is exactly what makes it dangerous.
 *
 * Only the three overall share metrics are pulled at period grain, so the top
 * and absolute-top tiers come back `ingested: false`. They are not masked and
 * must not be shown as masked.
 */
export function buildImpressionShareReportFromRows(input: {
  range: DateRange;
  /** Rows for this client, any window; only exact-range rows are used. */
  periodRows: readonly StoredImpressionSharePeriodRow[];
  /** Campaign display names by `campaign_key`, from `ad_campaigns`. */
  campaignNames?: ReadonlyMap<string, string>;
  /** Spend per campaign key, so tier averages stay spend-weighted. */
  campaignSpend?: ReadonlyMap<string, number>;
}): ImpressionShareReport | null {
  const exact = input.periodRows.filter(
    (row) =>
      row.rangeStart === input.range.start && row.rangeEnd === input.range.end,
  );

  // No row for this exact window is not an error: the reader picked a period
  // nobody has asked Google about yet. The caller falls back rather than
  // showing a figure derived from masked days.
  if (exact.length === 0) return null;

  const campaignRows = exact.filter((row) => row.scope === "campaign");
  if (campaignRows.length === 0) return null;

  const notIngested = (
    key: ImpressionShareTierKey,
    label: string,
  ): ImpressionShareTier => ({
    key,
    label,
    share: { value: null, masked: false },
    lostToRank: { value: null, masked: false },
    lostToBudget: { value: null, masked: false },
    ingested: false,
  });

  const rows = campaignRows.map<ImpressionShareRow>((row) => ({
    campaign: input.campaignNames?.get(row.campaignKey) ?? row.campaignKey,
    // Period share rows carry no status; a campaign Google reported
    // impressions for in this window was serving in it.
    status: "active",
    spend: input.campaignSpend?.get(row.campaignKey) ?? 0,
    tiers: {
      overall: {
        key: "overall",
        label: "Overall",
        share: maskedShare(row.searchImpressionShare),
        lostToRank: maskedShare(row.searchRankLostImpressionShare),
        lostToBudget: maskedShare(row.searchBudgetLostImpressionShare),
        ingested: true,
      },
      top: notIngested("top", "Top of page"),
      absoluteTop: notIngested("absoluteTop", "Absolute top"),
    },
  }));

  return finaliseImpressionShareReport(rows, input.range, "measured");
}

/**
 * Google's masking threshold as a ratio. Any share Google reports at or below
 * this is a mask, not a measurement.
 */
export const IMPRESSION_SHARE_MASK_FLOOR = 0.0999;
/** The matching mask at the other end: "above 90%". */
export const IMPRESSION_SHARE_MASK_CEILING = 0.9001;

/** One stored period-grain share row, as the reader returns it. */
export interface StoredImpressionSharePeriodRow {
  rangeStart: string;
  rangeEnd: string;
  scope: "account" | "campaign";
  campaignKey: string;
  impressions: number;
  searchImpressionShare: number | null;
  searchBudgetLostImpressionShare: number | null;
  searchRankLostImpressionShare: number | null;
}

/** Daily share values, as they sit on the stored metric rows. */
export interface DailyShareInput {
  searchBudgetLostImpressionShare: number | null;
  searchRankLostImpressionShare: number | null;
  impressions: number;
}

export interface PeriodAuctionShare {
  lostToRankRatio: number | null;
  lostToBudgetRatio: number | null;
  /**
   * `period_exact` only when Google itself answered for this exact window.
   * Anything reconstructed from days is `daily_derived`, which the contract
   * renders with a `~` and an explicit provisional message.
   */
  aggregationBasis: "period_exact" | "daily_derived" | "unavailable";
  /** True when a value came back on Google's masked tail rather than measured. */
  rankIsMasked: boolean;
  budgetIsMasked: boolean;
  /** Days whose share was masked, when the figures had to be derived. */
  maskedDays: number;
  consideredDays: number;
}

function isMasked(value: number | null): boolean {
  return (
    value !== null &&
    (value <= IMPRESSION_SHARE_MASK_FLOOR || value >= IMPRESSION_SHARE_MASK_CEILING)
  );
}

/**
 * Picks the period figure for the auction panel, preferring Google's own
 * answer over anything this codebase can compute.
 *
 * The preference is not a style choice. Impression-share denominators are
 * eligible impressions, which Google does not publish, so a weighted daily
 * average is an approximation of a number Google will happily state exactly.
 * When most days are masked the approximation drifts, and a derived
 * lost-to-budget share can land at half of Google's own figure. Falling back to daily rows is still better than showing nothing, but
 * it is labelled `daily_derived` so the contract prints it as an estimate.
 */
export function resolvePeriodAuctionShare(
  range: DateRange,
  periodRows: readonly StoredImpressionSharePeriodRow[],
  dailyRows: readonly DailyShareInput[] = [],
): PeriodAuctionShare {
  const exact = periodRows.find(
    (row) =>
      row.scope === "account" &&
      row.rangeStart === range.start &&
      row.rangeEnd === range.end,
  );

  if (exact) {
    return {
      lostToRankRatio: exact.searchRankLostImpressionShare,
      lostToBudgetRatio: exact.searchBudgetLostImpressionShare,
      aggregationBasis:
        exact.searchRankLostImpressionShare === null &&
        exact.searchBudgetLostImpressionShare === null
          ? "unavailable"
          : "period_exact",
      rankIsMasked: isMasked(exact.searchRankLostImpressionShare),
      budgetIsMasked: isMasked(exact.searchBudgetLostImpressionShare),
      maskedDays: 0,
      consideredDays: 0,
    };
  }

  // No stored period row for this exact window. Impression-weighted daily
  // average, reported as derived, with the masked-day count carried so a caller
  // can decide the estimate is too thin to show at all.
  const considered = dailyRows.filter(
    (row) =>
      row.impressions > 0 &&
      (row.searchRankLostImpressionShare !== null ||
        row.searchBudgetLostImpressionShare !== null),
  );

  if (considered.length === 0) {
    return {
      lostToRankRatio: null,
      lostToBudgetRatio: null,
      aggregationBasis: "unavailable",
      rankIsMasked: false,
      budgetIsMasked: false,
      maskedDays: 0,
      consideredDays: 0,
    };
  }

  const weighted = (pick: (row: DailyShareInput) => number | null): number | null => {
    let weight = 0;
    let total = 0;
    for (const row of considered) {
      const value = pick(row);
      if (value === null) continue;
      weight += row.impressions;
      total += value * row.impressions;
    }
    return weight === 0 ? null : Math.min(1, total / weight);
  };

  return {
    lostToRankRatio: weighted((row) => row.searchRankLostImpressionShare),
    lostToBudgetRatio: weighted((row) => row.searchBudgetLostImpressionShare),
    aggregationBasis: "daily_derived",
    rankIsMasked: considered.some((row) => isMasked(row.searchRankLostImpressionShare)),
    budgetIsMasked: considered.some((row) =>
      isMasked(row.searchBudgetLostImpressionShare),
    ),
    maskedDays: considered.filter(
      (row) =>
        isMasked(row.searchRankLostImpressionShare) ||
        isMasked(row.searchBudgetLostImpressionShare),
    ).length,
    consideredDays: considered.length,
  };
}
