import type { Currency, DateRange } from "@/lib/dashboard/types";

/**
 * Device breakdown for Google Ads.
 *
 * Google segments by `segments.device`, and the values below match its
 * vocabulary. Meta reports placements and platforms instead, so this panel
 * stays Google-only rather than pretending the two are the same cut.
 *
 * The diagnostic is not "which device spends most" but the gap between the
 * share of spend a device takes and the share of purchases it returns. That
 * gap is what a bid adjustment is for.
 */
export type DeviceKey = "mobile" | "desktop" | "tablet" | "connectedTv";

export const DEVICE_LABELS: Record<DeviceKey, string> = {
  mobile: "Mobile",
  desktop: "Desktop",
  tablet: "Tablet",
  connectedTv: "Connected TV",
};

/** Google's `segments.device` enum, mapped onto the keys above. */
export const GOOGLE_DEVICE_ENUM: Record<string, DeviceKey> = {
  MOBILE: "mobile",
  DESKTOP: "desktop",
  TABLET: "tablet",
  CONNECTED_TV: "connectedTv",
};

export interface DeviceRow {
  device: DeviceKey;
  label: string;
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
  conversionRate: number | null;
  returnOnAdSpend: number | null;
  spendShare: number;
  purchaseShare: number;
  /** Purchase share minus spend share: negative means the device is subsidised. */
  efficiencyGap: number;
}

export interface DeviceAnalysis {
  platform: "google";
  range: DateRange;
  currency: Currency;
  rows: DeviceRow[];
  totals: {
    spend: number;
    purchases: number;
    registrations: number;
    purchaseValue: number;
  };
  /** The device whose spend most outruns its purchases. */
  biggestSubsidy: DeviceRow | null;
  biggestBargain: DeviceRow | null;
  safeMessage: string;
  /**
   * Where these figures come from. `measured` means one row per device per day
   * as Google reported it; `modelled` means account totals split by fixed
   * shares, which is only fit for a fixtures build.
   */
  basis: "measured" | "modelled";
  /**
   * Spend Google reported under a device this dashboard does not model —
   * `OTHER` in `segments.device`. Carried rather than dropped, because a
   * silently discarded bucket is what makes a device table stop reconciling
   * with the account total. Null when nothing was unmapped.
   */
  unmapped: { spend: number; clicks: number; impressions: number } | null;
}

/** One stored `ad_device_daily` row, as the reader hands it over. */
export interface StoredDeviceRow {
  date: string;
  /** Google's `segments.device` enum, exactly as stored. */
  device: string;
  spend: number;
  impressions: number;
  clicks: number;
  registrations: number | null;
  purchases: number | null;
  purchaseValue: number | null;
}

interface DeviceShape {
  device: DeviceKey;
  spendShare: number;
  clickShare: number;
  impressionShare: number;
  /** Conversion rate relative to desktop, which sits at 1. */
  conversionIndex: number;
  averageOrderValueIndex: number;
}

const DEVICE_SHAPES: DeviceShape[] = [
  // Impression share is deliberately not proportional to click share: that is
  // what makes click-through rate differ between devices. When the two ran in
  // step every device reported the same 2% CTR and the column looked broken.
  {
    device: "mobile",
    spendShare: 0.58,
    clickShare: 0.64,
    impressionShare: 0.74,
    conversionIndex: 0.52,
    averageOrderValueIndex: 0.84,
  },
  {
    device: "desktop",
    spendShare: 0.31,
    clickShare: 0.26,
    impressionShare: 0.18,
    conversionIndex: 1,
    averageOrderValueIndex: 1,
  },
  {
    device: "tablet",
    spendShare: 0.09,
    clickShare: 0.08,
    impressionShare: 0.06,
    conversionIndex: 0.74,
    averageOrderValueIndex: 0.93,
  },
  {
    device: "connectedTv",
    spendShare: 0.02,
    clickShare: 0.02,
    impressionShare: 0.02,
    conversionIndex: 0.12,
    averageOrderValueIndex: 0.7,
  },
];

/**
 * Gives the synthetic preview a small, deterministic device-mix movement over
 * time. Without it every comparison period had the same share split, so the
 * previous-period marker sat exactly under the current endpoint and looked
 * broken. The adjustments always cancel out, preserving a 100% spend split.
 */
function deviceMixWave(range: DateRange): number {
  const end = new Date(`${range.end}T00:00:00Z`).getTime();
  const previewAnchor = Date.UTC(2026, 7, 12);
  const daysFromAnchor = (end - previewAnchor) / 86_400_000;
  return Math.sin(daysFromAnchor / 9) * 0.018;
}

function shapesForRange(range: DateRange): DeviceShape[] {
  const wave = deviceMixWave(range);
  const spendAdjustments: Record<DeviceKey, number> = {
    mobile: wave,
    desktop: -wave * 0.7,
    tablet: -wave * 0.2,
    connectedTv: -wave * 0.1,
  };
  const conversionAdjustments: Record<DeviceKey, number> = {
    mobile: wave * 1.4,
    desktop: -wave * 0.8,
    tablet: wave * 0.3,
    connectedTv: 0,
  };

  return DEVICE_SHAPES.map((shape) => ({
    ...shape,
    spendShare: shape.spendShare + spendAdjustments[shape.device],
    conversionIndex:
      shape.conversionIndex + conversionAdjustments[shape.device],
  }));
}

function safeDivide(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function buildDeviceAnalysis(input: {
  range: DateRange;
  currency: Currency;
  googleSpend: number;
  googleImpressions: number;
  googleClicks: number;
  googlePurchases: number;
  googleRegistrations: number;
  googlePurchaseValue: number;
}): DeviceAnalysis {
  // Conversions are distributed by click share weighted with each device's
  // conversion index, so the split reproduces the usual pattern: mobile buys
  // the clicks, desktop closes the orders.
  const periodShapes = shapesForRange(input.range);
  const weightTotal = periodShapes.reduce(
    (total, shape) => total + shape.clickShare * shape.conversionIndex,
    0,
  );

  const rows = periodShapes.map<DeviceRow>((shape) => {
    const conversionWeight =
      weightTotal === 0 ? 0 : (shape.clickShare * shape.conversionIndex) / weightTotal;
    const spend = round(input.googleSpend * shape.spendShare);
    const impressions = Math.round(input.googleImpressions * shape.impressionShare);
    const clicks = Math.round(input.googleClicks * shape.clickShare);
    const purchases = Math.round(input.googlePurchases * conversionWeight);
    const registrations = Math.round(
      input.googleRegistrations * conversionWeight,
    );
    // Revenue is derived from the rounded order count, not from the weight, so
    // a device with no orders cannot report money. It used to show $4 of
    // purchase value and a 0.35x ROAS against zero purchases.
    const averageOrderValue =
      input.googlePurchases === 0
        ? 0
        : (input.googlePurchaseValue / input.googlePurchases) *
        shape.averageOrderValueIndex;
    const purchaseValue = round(purchases * averageOrderValue);

    return {
      device: shape.device,
      label: DEVICE_LABELS[shape.device],
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
      conversionRate: safeDivide(purchases + registrations, clicks),
      returnOnAdSpend: safeDivide(purchaseValue, spend),
      spendShare: 0,
      purchaseShare: 0,
      efficiencyGap: 0,
    };
  });

  return finaliseDeviceAnalysis(rows, {
    range: input.range,
    currency: input.currency,
    basis: "modelled",
    unmapped: null,
  });
}

/**
 * Shares, ranking and the read-out, shared by the modelled and measured
 * builders so the two cannot describe the same numbers differently.
 */
function finaliseDeviceAnalysis(
  rows: DeviceRow[],
  context: {
    range: DateRange;
    currency: Currency;
    basis: DeviceAnalysis["basis"];
    unmapped: DeviceAnalysis["unmapped"];
  },
): DeviceAnalysis {
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

  const ranked = withShares.toSorted(
    (left, right) => left.efficiencyGap - right.efficiencyGap,
  );
  // With no purchases every device shows a negative gap, which would name a
  // subsidy that does not exist. Nothing is comparable until an order lands.
  const hasPurchases = totalPurchases > 0;
  const biggestSubsidy = hasPurchases ? (ranked[0] ?? null) : null;
  const biggestBargain = hasPurchases ? (ranked.at(-1) ?? null) : null;

  return {
    platform: "google",
    range: context.range,
    currency: context.currency,
    basis: context.basis,
    unmapped: context.unmapped,
    rows: withShares.toSorted((left, right) => right.spend - left.spend),
    totals: {
      spend: round(totalSpend),
      purchases: totalPurchases,
      registrations: rows.reduce((total, row) => total + row.registrations, 0),
      purchaseValue: round(
        rows.reduce((total, row) => total + row.purchaseValue, 0),
      ),
    },
    biggestSubsidy,
    biggestBargain,
    safeMessage: !hasPurchases
      ? "No purchases landed on any device in this period, so no device can be called efficient or wasteful yet."
      : biggestSubsidy && biggestBargain && biggestSubsidy.efficiencyGap < -0.05
        ? `${biggestSubsidy.label} takes ${Math.round(
          biggestSubsidy.spendShare * 100,
        )}% of spend but returns ${Math.round(
          biggestSubsidy.purchaseShare * 100,
        )}% of purchases, while ${biggestBargain.label} does the opposite. That gap is what a device bid adjustment is for.`
        : "Spend and purchases are distributed proportionally across devices; no device is subsidising another.",
  };
}

/**
 * Device analysis from stored `ad_device_daily` rows.
 *
 * The modelled builder above splits account totals by fixed shares, which was
 * always a placeholder: against the first live backfill it was not close. The
 * model assumes desktop converts about twice as well as mobile; across the five
 * brands' 2026 year to date, desktop took a tenth of mobile's clicks and still
 * returned more than twice its purchases. A device bid adjustment taken from
 * the modelled split would have been pointed the wrong way.
 *
 * Rows Google reported under a device this dashboard does not model — `OTHER`
 * — are carried in `unmapped` rather than dropped, so the table can be checked
 * against the account total instead of quietly disagreeing with it.
 */
export function buildDeviceAnalysisFromRows(input: {
  rows: readonly StoredDeviceRow[];
  range: DateRange;
  currency: Currency;
}): DeviceAnalysis {
  const totals = new Map<DeviceKey, Omit<StoredDeviceRow, "date" | "device">>();
  const unmapped = { spend: 0, clicks: 0, impressions: 0 };

  for (const row of input.rows) {
    const key = GOOGLE_DEVICE_ENUM[row.device.toUpperCase()];

    if (!key) {
      unmapped.spend += row.spend;
      unmapped.clicks += row.clicks;
      unmapped.impressions += row.impressions;
      continue;
    }

    const current = totals.get(key) ?? {
      spend: 0,
      impressions: 0,
      clicks: 0,
      registrations: null as number | null,
      purchases: null as number | null,
      purchaseValue: null as number | null,
    };

    totals.set(key, {
      spend: current.spend + row.spend,
      impressions: current.impressions + row.impressions,
      clicks: current.clicks + row.clicks,
      registrations:
        row.registrations === null
          ? current.registrations
          : (current.registrations ?? 0) + row.registrations,
      purchases:
        row.purchases === null
          ? current.purchases
          : (current.purchases ?? 0) + row.purchases,
      purchaseValue:
        row.purchaseValue === null
          ? current.purchaseValue
          : (current.purchaseValue ?? 0) + row.purchaseValue,
    });
  }

  // Every modelled device keeps a row even at zero, so the table does not
  // change shape between periods and a device that stopped spending is visibly
  // at zero rather than missing.
  const rows = (Object.keys(DEVICE_LABELS) as DeviceKey[]).map<DeviceRow>(
    (device) => {
      const totalsForDevice = totals.get(device);
      const spend = round(totalsForDevice?.spend ?? 0);
      const impressions = totalsForDevice?.impressions ?? 0;
      const clicks = totalsForDevice?.clicks ?? 0;
      const registrations = totalsForDevice?.registrations ?? 0;
      const purchases = totalsForDevice?.purchases ?? 0;
      const purchaseValue = round(totalsForDevice?.purchaseValue ?? 0);

      return {
        device,
        label: DEVICE_LABELS[device],
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
        conversionRate: safeDivide(purchases + registrations, clicks),
        returnOnAdSpend: safeDivide(purchaseValue, spend),
        spendShare: 0,
        purchaseShare: 0,
        efficiencyGap: 0,
      };
    },
  );

  return finaliseDeviceAnalysis(rows, {
    range: input.range,
    currency: input.currency,
    basis: "measured",
    unmapped:
      unmapped.spend > 0 || unmapped.clicks > 0 || unmapped.impressions > 0
        ? {
          spend: round(unmapped.spend),
          clicks: unmapped.clicks,
          impressions: unmapped.impressions,
        }
        : null,
  });
}
