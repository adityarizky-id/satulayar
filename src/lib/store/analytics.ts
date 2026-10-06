import type { AccountOption } from "@/lib/dashboard/accounts";
import { addDays, inclusiveDays } from "@/lib/dashboard/calendar";
import { enumerateDates } from "@/lib/dashboard/data-quality";
import { safeDivide } from "@/lib/dashboard/kpi";
import {
  COMPARISON_WINDOW_LABELS,
  resolveComparisonRange,
  type ComparisonWindow,
} from "@/lib/dashboard/search-terms";
import type { Currency, DateRange } from "@/lib/dashboard/types";
import {
  buildAbandonedBaskets,
  buildCohortMonths,
  buildStoreOrders,
  buildStoreSessions,
  isSocialReferrer,
} from "@/lib/store/fixtures";
import { AWAITING_DISPATCH_STATES } from "@/lib/store/types";
import type {
  BreakdownRow,
  CatalogueBreakdown,
  CatalogueLevel,
  CatalogueNode,
  CatalogueStack,
  CatalogueStackMonth,
  ChannelPerformanceRow,
  CohortRow,
  CustomerRfmRow,
  FunnelStep,
  MonthlyComparisonRow,
  MonthlySalesPoint,
  ReferringChannel,
  RfmAnalysis,
  RfmSegmentKey,
  ShareRow,
  StoreAnalyticsSnapshot,
  StoreKpi,
  StoreOrder,
  StoreOrderState,
  StoreSession,
  TimeSeries,
  YearlyPerformance,
} from "@/lib/store/types";

const REFERRING_CHANNELS: ReferringChannel[] = [
  "Direct",
  "Paid",
  "Organic",
  "Social",
  "Unknown",
];

export function netSalesOf(order: StoreOrder): number {
  return order.grossSales - order.discounts - order.returns;
}

export function totalSalesOf(order: StoreOrder): number {
  return netSalesOf(order) + order.shippingCharges + order.taxes;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function groupByDate<T extends { date: string }>(
  rows: readonly T[],
): Map<string, T[]> {
  const index = new Map<string, T[]>();

  for (const row of rows) {
    const bucket = index.get(row.date);
    if (bucket) {
      bucket.push(row);
      continue;
    }
    index.set(row.date, [row]);
  }

  return index;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Rates are stored as fractions, so rounding them to two decimals would erase
 * everything below one percentage point and flatten real movement to 0%.
 */
function roundRate(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/**
 * Everything the snapshot needs to know about the chosen baseline, resolved
 * once so every panel answers the same question the reader asked in the
 * reporting-period picker rather than assuming the previous period.
 */
interface ComparisonContext {
  enabled: boolean;
  range: DateRange;
  activeDays: number;
  comparisonDays: number;
  /**
   * Additive baseline figures are multiplied by this so a 90-day lookback can
   * be read against a 14-day period. Ratios and averages keep their own
   * meaning after aggregation and are never scaled.
   */
  factor: number;
  normalised: boolean;
  alignedByDay: boolean;
  label: string;
}

function buildComparisonContext(
  range: DateRange,
  enabled: boolean,
  window: ComparisonWindow,
  customRange?: DateRange,
): ComparisonContext {
  const comparisonRange = resolveComparisonRange(range, window, customRange);
  const activeDays = inclusiveDays(range);
  const comparisonDays = inclusiveDays(comparisonRange);

  return {
    enabled,
    range: comparisonRange,
    activeDays,
    comparisonDays,
    factor: comparisonDays === 0 ? 1 : activeDays / comparisonDays,
    normalised: activeDays !== comparisonDays,
    alignedByDay: activeDays === comparisonDays,
    label: enabled ? COMPARISON_WINDOW_LABELS[window] : "No comparison",
  };
}

/** An additive baseline total, scaled to the active duration. */
function baselineTotal(
  comparison: ComparisonContext,
  value: number,
): number | null {
  return comparison.enabled ? round(value * comparison.factor) : null;
}

/** An additive baseline count. Rounded to a whole row, never a fraction. */
function baselineCount(
  comparison: ComparisonContext,
  value: number,
): number | null {
  return comparison.enabled ? Math.round(value * comparison.factor) : null;
}

/** A baseline ratio or average. Comparable as-is, so it is never scaled. */
function baselineRatio(
  comparison: ComparisonContext,
  value: number | null,
): number | null {
  return comparison.enabled ? value : null;
}

function shareRows<T>(
  rows: readonly T[],
  previousRows: readonly T[],
  comparison: ComparisonContext,
  keyOf: (row: T) => string,
  valueOf: (row: T) => number,
  limit = 8,
): ShareRow[] {
  const current = new Map<string, number>();
  const previous = new Map<string, number>();

  for (const row of rows) {
    const key = keyOf(row);
    current.set(key, (current.get(key) ?? 0) + valueOf(row));
  }
  for (const row of previousRows) {
    const key = keyOf(row);
    previous.set(key, (previous.get(key) ?? 0) + valueOf(row));
  }

  const total = sum([...current.values()]);

  return [...current.entries()]
    .map(([label, value]) => ({
      key: label,
      label,
      value: round(value),
      previousValue: baselineTotal(comparison, previous.get(label) ?? 0),
      share: total === 0 ? 0 : value / total,
    }))
    .toSorted((left, right) => right.value - left.value)
    .slice(0, limit);
}

/** A future store URL segment: lowercase, hyphenated, nothing else. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const catalogueDepartmentKey = (order: StoreOrder) =>
  `department::${slugify(order.productDepartment)}`;
const catalogueSubDepartmentKey = (order: StoreOrder) =>
  `${catalogueDepartmentKey(order)}::${slugify(order.productSubDepartment)}`;
const catalogueFamilyKey = (order: StoreOrder) =>
  `${catalogueSubDepartmentKey(order)}::${slugify(order.productFamily)}`;
const catalogueProductKey = (order: StoreOrder) =>
  `${catalogueFamilyKey(order)}::${slugify(order.productTitle)}`;
const catalogueDepartmentPath = (order: StoreOrder) =>
  `/department/${slugify(order.productDepartment)}`;
const catalogueSubDepartmentPath = (order: StoreOrder) =>
  `${catalogueDepartmentPath(order)}/sub-department/${slugify(order.productSubDepartment)}`;
const catalogueFamilyPath = (order: StoreOrder) =>
  `${catalogueSubDepartmentPath(order)}/family/${slugify(order.productFamily)}`;
const catalogueProductPath = (order: StoreOrder) =>
  `${catalogueFamilyPath(order)}/product/${slugify(order.productTitle)}`;

export const CATALOGUE_TOP_COUNT = 15;

/**
 * Department and sub-department remain complete. The two high-cardinality
 * levels are a fixed Top 15, ranked by sales value with a stable slug tie-break.
 */
export function catalogueRowsForDisplay(
  rows: readonly CatalogueNode[],
  level: CatalogueLevel,
): CatalogueNode[] {
  const ranked = rows.toSorted(
    (left, right) =>
      right.value - left.value || left.slug.localeCompare(right.slug),
  );

  return level === "family" || level === "product"
    ? ranked.slice(0, CATALOGUE_TOP_COUNT)
    : ranked;
}

/**
 * One layer of the store's product taxonomy. Every node keeps a path-qualified
 * key so two branches never collide on a repeated name (two departments each
 * with a "Seasonal" family, say), and a share computed against its own
 * siblings so a department-level share never gets diluted by product count.
 */
function catalogueLevel(
  orders: readonly StoreOrder[],
  previousOrders: readonly StoreOrder[],
  comparison: ComparisonContext,
  level: CatalogueLevel,
  labelOf: (order: StoreOrder) => string,
  keyOf: (order: StoreOrder) => string,
  pathOf: (order: StoreOrder) => string,
  parentKeyOf: (order: StoreOrder) => string | null,
  skuOf: (order: StoreOrder) => string | null = () => null,
): CatalogueNode[] {
  interface Aggregate {
    label: string;
    sku: string | null;
    path: string;
    parentKey: string | null;
    value: number;
    orders: number;
  }

  const current = new Map<string, Aggregate>();
  const previous = new Map<string, { value: number; orders: number }>();

  for (const order of orders) {
    const key = keyOf(order);
    const entry = current.get(key) ?? {
      label: labelOf(order),
      sku: skuOf(order),
      path: pathOf(order),
      parentKey: parentKeyOf(order),
      value: 0,
      orders: 0,
    };
    entry.value += totalSalesOf(order);
    entry.orders += 1;
    current.set(key, entry);
  }
  for (const order of previousOrders) {
    const key = keyOf(order);
    const entry = previous.get(key) ?? { value: 0, orders: 0 };
    entry.value += totalSalesOf(order);
    entry.orders += 1;
    previous.set(key, entry);
  }

  const siblingTotals = new Map<string | null, number>();
  for (const entry of current.values()) {
    siblingTotals.set(
      entry.parentKey,
      (siblingTotals.get(entry.parentKey) ?? 0) + entry.value,
    );
  }

  return [...current.entries()]
    .map(([key, entry]) => {
      const previousEntry = previous.get(key);
      const siblingTotal = siblingTotals.get(entry.parentKey) ?? 0;

      return {
        key,
        slug: slugify(entry.label),
        path: entry.path,
        label: entry.label,
        sku: entry.sku,
        level,
        parentKey: entry.parentKey,
        orders: entry.orders,
        previousOrders: baselineCount(comparison, previousEntry?.orders ?? 0),
        value: round(entry.value),
        previousValue: baselineTotal(comparison, previousEntry?.value ?? 0),
        share: siblingTotal === 0 ? 0 : entry.value / siblingTotal,
      };
    })
    .toSorted((left, right) => right.value - left.value);
}

function buildCatalogueBreakdown(
  orders: readonly StoreOrder[],
  previousOrders: readonly StoreOrder[],
  comparison: ComparisonContext,
): CatalogueBreakdown {
  return {
    department: catalogueLevel(
      orders,
      previousOrders,
      comparison,
      "department",
      (order) => order.productDepartment,
      catalogueDepartmentKey,
      catalogueDepartmentPath,
      () => null,
    ),
    subDepartment: catalogueLevel(
      orders,
      previousOrders,
      comparison,
      "subDepartment",
      (order) => order.productSubDepartment,
      catalogueSubDepartmentKey,
      catalogueSubDepartmentPath,
      catalogueDepartmentKey,
    ),
    family: catalogueLevel(
      orders,
      previousOrders,
      comparison,
      "family",
      (order) => order.productFamily,
      catalogueFamilyKey,
      catalogueFamilyPath,
      catalogueSubDepartmentKey,
    ),
    product: catalogueLevel(
      orders,
      previousOrders,
      comparison,
      "product",
      (order) => order.productTitle,
      catalogueProductKey,
      catalogueProductPath,
      catalogueFamilyKey,
      (order) => order.productSku,
    ),
  };
}

function timeSeries(
  key: string,
  label: string,
  unit: TimeSeries["unit"],
  range: DateRange,
  comparison: ComparisonContext,
  valueForDate: (date: string) => number,
  comparisonValueForDate: (date: string) => number,
  /**
   * False for a series of daily averages: summing them is not a total, and
   * scaling that sum to the active duration would compound the error.
   */
  additive = true,
): TimeSeries {
  const normalise = unit === "percent" ? roundRate : round;
  const dates = enumerateDates(range);
  // A day-by-day baseline is only drawn when the two periods run the same
  // number of days. Against a longer lookback the pairing would be arbitrary,
  // so the line is withheld and the panel says why.
  const comparisonDates =
    comparison.enabled && comparison.alignedByDay
      ? enumerateDates(comparison.range)
      : [];
  const points = dates.map((date, index) => {
    const comparisonDate = comparisonDates[index];
    return {
      date,
      value: normalise(valueForDate(date)),
      comparisonValue:
        comparisonDate === undefined
          ? null
          : normalise(comparisonValueForDate(comparisonDate)),
    };
  });
  const totalValue = sum(points.map((point) => point.value));
  const previousTotal = comparison.enabled
    ? sum(
        enumerateDates(comparison.range).map((date) =>
          comparisonValueForDate(date),
        ),
      )
    : null;

  const reportsTotals = unit !== "percent" && additive;

  return {
    key,
    label,
    unit,
    points,
    total: reportsTotals ? round(totalValue) : null,
    previousTotal:
      reportsTotals && previousTotal !== null
        ? baselineTotal(comparison, previousTotal)
        : null,
  };
}

function funnelSteps(
  sessions: readonly StoreSession[],
  previousSessions: readonly StoreSession[],
  comparison: ComparisonContext,
  valueContext: { averageOrderValue: number | null; realisedSales: number } | null =
    null,
): FunnelStep[] {
  const counts = [
    { key: "sessions", label: "Sessions", test: () => true },
    {
      key: "addedToCart",
      label: "Added to cart",
      test: (session: StoreSession) => session.addedToCart,
    },
    {
      key: "reachedCheckout",
      label: "Reached checkout",
      test: (session: StoreSession) => session.reachedCheckout,
    },
    {
      key: "completedCheckout",
      label: "Completed checkout",
      test: (session: StoreSession) => session.completedCheckout,
    },
  ];
  const entry = sessions.length;

  return counts.map((step, index) => {
    const current = sessions.filter(step.test).length;
    const previousStepCount =
      index === 0
        ? null
        : sessions.filter(counts[index - 1]?.test ?? (() => true)).length;

    const isFinalStep = index === counts.length - 1;
    const salesValue =
      valueContext === null
        ? null
        : isFinalStep
          ? round(valueContext.realisedSales)
          : round(current * (valueContext.averageOrderValue ?? 0));

    return {
      key: step.key,
      label: step.label,
      sessions: current,
      previousSessions: baselineCount(
        comparison,
        previousSessions.filter(step.test).length,
      ),
      rateFromEntry: entry === 0 ? 0 : current / entry,
      rateFromPreviousStep:
        previousStepCount === null || previousStepCount === 0
          ? null
          : current / previousStepCount,
      salesValue,
    };
  });
}

function channelPerformance(
  sessions: readonly StoreSession[],
  orders: readonly StoreOrder[],
): ChannelPerformanceRow[] {
  return REFERRING_CHANNELS.map((channel) => {
    const channelSessions = sessions.filter(
      (session) => session.referringChannel === channel,
    );
    const channelOrders = orders.filter(
      (order) => order.referringChannel === channel,
    );
    const totalSales = round(sum(channelOrders.map(totalSalesOf)));

    return {
      channel,
      sessions: channelSessions.length,
      orders: channelOrders.length,
      totalSales,
      conversionRate: safeDivide(channelOrders.length, channelSessions.length),
      averageOrderValue: safeDivide(totalSales, channelOrders.length),
    };
  }).toSorted((left, right) => right.totalSales - left.totalSales);
}

function buildCohorts(rangeEnd: string): CohortRow[] {
  const months = buildCohortMonths(rangeEnd);

  return months.map((month, index) => {
    const customers = 4 + index * 3 + (index % 2 === 0 ? 2 : 0);
    const monthsObserved = months.length - index;
    const retention = Array.from({ length: monthsObserved }, (_, step) => {
      if (step === 0) return 1;
      const decayed = 0.34 * Math.pow(0.72, step - 1) - index * 0.004;
      return Math.max(0, Math.round(decayed * 1000) / 1000);
    });

    return { cohort: month, customers, retention };
  });
}

export const RFM_FIELD_LABELS: RfmAnalysis["fieldLabels"] = {
  segment: "RFM segment",
  customerShare: "Percent of customers",
  customerCount: "Customer records",
  averageRecencyDays: "Average days since last order",
  totalOrders: "Total number of orders",
  totalSpent: "Total amount spent",
};

const RFM_SEGMENTS: { key: RfmSegmentKey; label: string }[] = [
  { key: "previouslyLoyal", label: "Previously loyal" },
  { key: "atRisk", label: "At risk" },
  { key: "dormant", label: "Dormant" },
  { key: "loyal", label: "Loyal" },
  { key: "champions", label: "Champions" },
  { key: "needsAttention", label: "Needs attention" },
  { key: "almostLost", label: "Almost lost" },
  { key: "active", label: "Active" },
  { key: "promising", label: "Promising" },
  { key: "new", label: "New" },
];

interface CustomerRfm {
  customerId: string;
  recencyDays: number;
  lastOrderDate: string;
  frequency: number;
  monetary: number;
  categoryCounts: Map<string, number>;
}

const STATUS_TAGS: Record<RfmSegmentKey, string> = {
  champions: "VIP Champion",
  loyal: "Loyal High-Value",
  active: "Active Repeat",
  atRisk: "At Risk of Churn",
  almostLost: "Win-Back Priority",
  previouslyLoyal: "Lapsed VIP",
  dormant: "Dormant / Inactive",
  promising: "Promising Growth",
  new: "First-Time Buyer",
  needsAttention: "Needs Attention",
};

const DAY_MS = 86_400_000;

function daysBetweenDates(start: string, end: string): number {
  return Math.max(
    0,
    Math.round(
      (new Date(`${end}T00:00:00Z`).getTime() -
        new Date(`${start}T00:00:00Z`).getTime()) /
        DAY_MS,
    ),
  );
}

function quintileScore(
  value: number,
  sortedValues: readonly number[],
  higherIsBetter: boolean,
): number {
  if (sortedValues.length <= 1) return 5;

  const firstMatch = sortedValues.findIndex((candidate) => candidate >= value);
  const rank = firstMatch === -1 ? sortedValues.length - 1 : firstMatch;
  const ascendingScore = Math.min(
    5,
    Math.floor((rank / (sortedValues.length - 1)) * 5) + 1,
  );

  return higherIsBetter ? ascendingScore : 6 - ascendingScore;
}

function rfmSegmentFor(recency: number, frequencyMonetary: number): RfmSegmentKey {
  if (recency <= 2 && frequencyMonetary === 5) return "previouslyLoyal";
  if (recency <= 2 && frequencyMonetary >= 3) return "atRisk";
  if (recency <= 2) return "dormant";
  if (recency <= 4 && frequencyMonetary >= 4) return "loyal";
  if (recency === 5 && frequencyMonetary >= 4) return "champions";
  if (recency === 3 && frequencyMonetary === 3) return "needsAttention";
  if (recency === 3) return "almostLost";
  if (frequencyMonetary >= 2) return "active";
  return recency === 4 ? "promising" : "new";
}

/**
 * Point-in-time customer segmentation. The adapter boundary only needs to
 * normalise live store rows into StoreOrder; labels remain a presentation
 * contract rather than leaking provider column names into the UI.
 */
export function buildRfmAnalysis(
  orders: readonly StoreOrder[],
  asOfDate: string,
  lookbackRange: DateRange,
  country = "GB",
): RfmAnalysis {
  const customers = new Map<string, CustomerRfm>();

  for (const order of orders) {
    const existing = customers.get(order.customerId);
    const monetary = totalSalesOf(order);
    const category = order.productDepartment || order.productFamily || "General";

    if (!existing) {
      const categoryCounts = new Map<string, number>();
      categoryCounts.set(category, 1);
      customers.set(order.customerId, {
        customerId: order.customerId,
        recencyDays: daysBetweenDates(order.date, asOfDate),
        lastOrderDate: order.date,
        frequency: 1,
        monetary,
        categoryCounts,
      });
      continue;
    }

    if (order.date > existing.lastOrderDate) {
      existing.lastOrderDate = order.date;
      existing.recencyDays = daysBetweenDates(order.date, asOfDate);
    }
    existing.frequency += 1;
    existing.monetary += monetary;
    existing.categoryCounts.set(
      category,
      (existing.categoryCounts.get(category) ?? 0) + 1,
    );
  }

  const customerRows = [...customers.values()];
  const recencies = customerRows.map((row) => row.recencyDays).toSorted((a, b) => a - b);
  const frequencies = customerRows.map((row) => row.frequency).toSorted((a, b) => a - b);
  const monetaryValues = customerRows.map((row) => row.monetary).toSorted((a, b) => a - b);
  const grouped = new Map<RfmSegmentKey, CustomerRfm[]>();

const FIRST_NAMES = [
  "Adi", "Ayu", "Bima", "Citra", "Dewi", "Eka", "Fajar", "Gita", "Hana", "Indra",
  "Joko", "Kartika", "Lestari", "Made", "Nadia", "Oka", "Putri", "Raka", "Sari", "Teguh",
  "Wulan", "Yoga", "Aisyah", "Rizal", "Nurul", "Hafiz", "Siti", "Farid", "Mei Ling", "Wei Jie",
];

const LAST_NAMES = [
  "Santoso", "Wijaya", "Pratama", "Saputra", "Hidayat", "Kusuma", "Nugroho", "Wibowo", "Halim", "Gunawan",
  "Setiawan", "Siregar", "Nasution", "Lubis", "Putra", "Rahman", "Ismail", "Tan", "Lim", "Wong",
];

const COMPANY_SECTORS = [
  "Kopi", "Kriya", "Batik", "Herbal", "Rumah", "Studio", "Living", "Karya",
  "Nusantara", "Craft", "Home Goods", "Alam", "Lestari", "Sejahtera", "Makmur",
];

const COMPANY_LEGAL = ["PT", "CV", "UD", "Sdn Bhd", "Pte Ltd", "Store", "Group", "Trading", "Supply", "Collective"];

const CUSTOMER_MARKETS: Record<
  string,
  { phonePrefix: string; subscriberDigits: number; zipCodes: readonly string[] }
> = {
  ID: {
    phonePrefix: "+62812",
    subscriberDigits: 8,
    zipCodes: ["12190", "40132", "60271", "80361", "55223"],
  },
  MY: {
    phonePrefix: "+6012",
    subscriberDigits: 7,
    zipCodes: ["50450", "47301", "10200", "80000", "40000"],
  },
  SG: {
    phonePrefix: "+658",
    subscriberDigits: 7,
    zipCodes: ["238859", "129588", "828761", "048424", "018956"],
  },
};

function hashCustomerId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function generateCustomerProfile(
  customerId: string,
  country: string,
): {
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  zip: string;
  country: string;
  company: string;
} {
  const hash = hashCustomerId(customerId);
  const first = FIRST_NAMES[hash % FIRST_NAMES.length] || "Alex";
  const last = LAST_NAMES[(hash >>> 4) % LAST_NAMES.length] || "Morgan";
  const sector = COMPANY_SECTORS[(hash >>> 8) % COMPANY_SECTORS.length] || "Nusantara";
  const legal = COMPANY_LEGAL[(hash >>> 12) % COMPANY_LEGAL.length] || "PT";

  const name = `${first} ${last}`;
  const company = `${last} ${sector} ${legal}`;
  const local = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const cleanDomain = `${local(last)}-${local(sector)}.example`;
  const email = `${local(first)}.${local(last)}@${cleanDomain}`;
  const market = CUSTOMER_MARKETS[country] ?? CUSTOMER_MARKETS.ID!;
  const subscriber = (hash % 10 ** market.subscriberDigits)
    .toString()
    .padStart(market.subscriberDigits, "0");
  const phone = `${market.phonePrefix}${subscriber}`;
  const zip = market.zipCodes[(hash >>> 16) % market.zipCodes.length] as string;

  return {
    name,
    firstName: first,
    lastName: last,
    email,
    phone,
    zip,
    country: CUSTOMER_MARKETS[country] ? country : "ID",
    company,
  };
}

  const customerList: CustomerRfmRow[] = customerRows.map((customer) => {
    const recencyScore = quintileScore(customer.recencyDays, recencies, false);
    const frequencyScore = quintileScore(customer.frequency, frequencies, true);
    const monetaryScore = quintileScore(customer.monetary, monetaryValues, true);
    const frequencyMonetaryScore = Math.round((frequencyScore + monetaryScore) / 2);
    const segmentKey = rfmSegmentFor(recencyScore, frequencyMonetaryScore);
    const segmentDef = RFM_SEGMENTS.find((s) => s.key === segmentKey);
    const profile = generateCustomerProfile(customer.customerId, country);

    const bucket = grouped.get(segmentKey);
    if (bucket) bucket.push(customer);
    else grouped.set(segmentKey, [customer]);

    let topCategory = "General";
    let maxCatCount = 0;
    for (const [cat, count] of customer.categoryCounts.entries()) {
      if (count > maxCatCount) {
        maxCatCount = count;
        topCategory = cat;
      }
    }

    return {
      customerId: customer.customerId,
      name: profile.name,
      firstName: profile.firstName,
      lastName: profile.lastName,
      email: profile.email,
      phone: profile.phone,
      zip: profile.zip,
      country: profile.country,
      company: profile.company,
      segmentKey,
      segmentLabel: segmentDef?.label ?? segmentKey,
      recencyDays: customer.recencyDays,
      lastOrderDate: customer.lastOrderDate,
      frequency: customer.frequency,
      monetary: round(customer.monetary),
      aov: round(customer.monetary / (customer.frequency || 1)),
      topCategory,
      statusTag: STATUS_TAGS[segmentKey] ?? "Active",
      recencyScore,
      frequencyScore,
      monetaryScore,
    };
  });

  const customerCount = customerRows.length;
  const totalOrders = sum(customerRows.map((row) => row.frequency));
  const totalSpent = sum(customerRows.map((row) => row.monetary));

  return {
    asOfDate,
    lookbackRange,
    fieldLabels: RFM_FIELD_LABELS,
    summary: {
      customerShare: customerCount === 0 ? 0 : 1,
      customerCount,
      averageRecencyDays:
        customerCount === 0
          ? 0
          : Math.round(sum(customerRows.map((row) => row.recencyDays)) / customerCount),
      totalOrders,
      totalSpent: round(totalSpent),
    },
    segments: RFM_SEGMENTS.map((definition) => {
      const rows = grouped.get(definition.key) ?? [];
      return {
        ...definition,
        customerShare:
          customerCount === 0 ? 0 : roundRate(rows.length / customerCount),
        customerCount: rows.length,
        averageRecencyDays:
          rows.length === 0
            ? 0
            : Math.round(sum(rows.map((row) => row.recencyDays)) / rows.length),
        totalOrders: sum(rows.map((row) => row.frequency)),
        totalSpent: round(sum(rows.map((row) => row.monetary))),
      };
    }),
    customers: customerList,
  };
}

const MONTH_LABELS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function monthTotals(
  year: number,
  month: number,
  throughDay: number | null,
  scale: number,
): { sales: number; orders: number } {
  const lastDay = throughDay ?? daysInMonth(year, month);
  const monthOrders = buildStoreOrders(
    {
      start: `${year}-${pad(month)}-01`,
      end: `${year}-${pad(month)}-${pad(lastDay)}`,
    },
    scale,
  );

  return {
    sales: round(sum(monthOrders.map(totalSalesOf))),
    orders: monthOrders.length,
  };
}

function deltaPercent(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/**
 * Monthly sales for the full previous year plus the current year to date, with
 * every partial month matched against the same days a year earlier so the
 * comparison is like-for-like instead of a full month against a half one.
 */
export function buildYearlyPerformance(
  referenceDate: string,
  scale = 1,
): YearlyPerformance {
  const currentYear = Number(referenceDate.slice(0, 4));
  const previousYear = currentYear - 1;
  const twoYearsAgo = currentYear - 2;
  const currentMonth = Number(referenceDate.slice(5, 7));
  const referenceDay = Number(referenceDate.slice(8, 10));
  const partialDay =
    referenceDay < daysInMonth(currentYear, currentMonth) ? referenceDay : null;

  const fullYearMonths = (year: number): MonthlySalesPoint[] =>
    MONTH_LABELS.map((label, index) => {
      const month = index + 1;
      const totals = monthTotals(year, month, null, scale);
      return {
        month: `${year}-${pad(month)}`,
        label,
        sales: totals.sales,
        orders: totals.orders,
        isPartial: false,
        throughDay: null,
      };
    });

  const twoYearsAgoMonths = fullYearMonths(twoYearsAgo);
  const previousYearMonths = fullYearMonths(previousYear);

  const currentYearMonths: MonthlySalesPoint[] = [];
  const comparison: MonthlyComparisonRow[] = [];

  for (let month = 1; month <= currentMonth; month += 1) {
    const isPartial = month === currentMonth && partialDay !== null;
    const throughDay = isPartial ? partialDay : null;
    const current = monthTotals(currentYear, month, throughDay, scale);
    const previous = monthTotals(previousYear, month, throughDay, scale);
    const label = MONTH_LABELS[month - 1] as string;

    currentYearMonths.push({
      month: `${currentYear}-${pad(month)}`,
      label,
      sales: current.sales,
      orders: current.orders,
      isPartial,
      throughDay,
    });

    comparison.push({
      month: `${currentYear}-${pad(month)}`,
      label: isPartial ? `${label} (1–${throughDay})` : label,
      currentSales: current.sales,
      currentOrders: current.orders,
      previousSales: previous.sales,
      previousOrders: previous.orders,
      salesDeltaPercent: deltaPercent(current.sales, previous.sales),
      ordersDeltaPercent: deltaPercent(current.orders, previous.orders),
      isPartial,
      throughDay,
    });
  }

  const currentSales = round(
    sum(comparison.map((row) => row.currentSales)),
  );
  const currentOrders = sum(comparison.map((row) => row.currentOrders));
  const previousSales = round(sum(comparison.map((row) => row.previousSales)));
  const previousOrders = sum(comparison.map((row) => row.previousOrders));
  const bestMonth =
    previousYearMonths.toSorted((left, right) => right.sales - left.sales).at(0) ??
    null;
  const throughLabel = partialDay
    ? `${MONTH_LABELS[currentMonth - 1]} 1–${partialDay}`
    : (MONTH_LABELS[currentMonth - 1] as string);

  const alignCurrentMonth = (
    year: number,
    months: MonthlySalesPoint[],
  ): MonthlySalesPoint[] =>
    months.map((point, index) => {
      const month = index + 1;
      if (month !== currentMonth || partialDay === null) return point;
      const totals = monthTotals(year, month, partialDay, scale);
      return {
        ...point,
        sales: totals.sales,
        orders: totals.orders,
        isPartial: true,
        throughDay: partialDay,
      };
    });

  return {
    currentYear,
    previousYear,
    twoYearsAgo,
    twoYearsAgoMonths,
    previousYearMonths,
    currentYearMonths,
    comparisonYears: [
      {
        year: twoYearsAgo,
        months: alignCurrentMonth(twoYearsAgo, twoYearsAgoMonths),
      },
      {
        year: previousYear,
        months: alignCurrentMonth(previousYear, previousYearMonths),
      },
      { year: currentYear, months: currentYearMonths },
    ],
    comparison,
    ytd: {
      label: `January – ${throughLabel}`,
      currentSales,
      currentOrders,
      previousSales,
      previousOrders,
      salesDeltaPercent: deltaPercent(currentSales, previousSales),
      ordersDeltaPercent: deltaPercent(currentOrders, previousOrders),
    },
    bestMonth,
    note: bestMonth
      ? `${bestMonth.label} ${previousYear} was the strongest month of last year. The chart also keeps ${twoYearsAgo} visible for seasonal context. The Q4 peak of ${currentYear} has not happened yet, so the yearly ranking can still change.`
      : "No completed month is available for the previous year.",
  };
}

function catalogueLevelKeyFns(level: CatalogueLevel): {
  own: (order: StoreOrder) => string;
  parent: (order: StoreOrder) => string | null;
} {
  if (level === "department") {
    return { own: catalogueDepartmentKey, parent: () => null };
  }
  if (level === "subDepartment") {
    return { own: catalogueSubDepartmentKey, parent: catalogueDepartmentKey };
  }
  if (level === "family") {
    return { own: catalogueFamilyKey, parent: catalogueSubDepartmentKey };
  }
  return { own: catalogueProductKey, parent: catalogueFamilyKey };
}

function catalogueStackMonthTotals(
  year: number,
  month: number,
  throughDay: number | null,
  level: CatalogueLevel,
  parentKey: string | null,
  nodeKeys: ReadonlySet<string>,
  scale: number,
): {
  values: Record<string, number>;
  orders: Record<string, number>;
  other: number;
} {
  const lastDay = throughDay ?? daysInMonth(year, month);
  const orders = buildStoreOrders(
    {
      start: `${year}-${pad(month)}-01`,
      end: `${year}-${pad(month)}-${pad(lastDay)}`,
    },
    scale,
  );
  const { own, parent } = catalogueLevelKeyFns(level);
  const totals = new Map<string, number>();
  const orderCounts = new Map<string, number>();
  let other = 0;

  for (const order of orders) {
    if (parentKey !== null && parent(order) !== parentKey) continue;
    const amount = totalSalesOf(order);
    const key = own(order);

    if (nodeKeys.has(key)) {
      totals.set(key, (totals.get(key) ?? 0) + amount);
      orderCounts.set(key, (orderCounts.get(key) ?? 0) + 1);
    } else {
      other += amount;
    }
  }

  const values: Record<string, number> = {};
  const ordersMap: Record<string, number> = {};
  for (const [key, value] of totals) values[key] = round(value);
  for (const [key, count] of orderCounts) ordersMap[key] = count;
  return { values, orders: ordersMap, other: round(other) };
}

/**
 * Monthly value per node for the three most recent calendar years, scoped to
 * one drill-down step (a department, a sub-department, or a family). The
 * node set is whichever top rows the caller already has on screen, so the
 * chart's legend never disagrees with the table underneath it. Only
 * department and sub-department pass every row here. Family and product pass
 * their ranked Top 15, and everything outside it lands in "other" instead of
 * vanishing silently.
 */
export function buildCatalogueStack(
  nodes: Pick<CatalogueNode, "key" | "slug" | "label">[],
  level: CatalogueLevel,
  parentKey: string | null,
  referenceDate: string,
  scale = 1,
): CatalogueStack {
  const currentYear = Number(referenceDate.slice(0, 4));
  const previousYear = currentYear - 1;
  const twoYearsAgo = currentYear - 2;
  const currentMonth = Number(referenceDate.slice(5, 7));
  const referenceDay = Number(referenceDate.slice(8, 10));
  const partialDay =
    referenceDay < daysInMonth(currentYear, currentMonth) ? referenceDay : null;
  const nodeKeys = new Set(nodes.map((node) => node.key));
  const hasOther = level !== "department";

  const yearMonths = (year: number): CatalogueStackMonth[] => {
    const points: CatalogueStackMonth[] = [];

    for (let month = 1; month <= 12; month += 1) {
      const isFuture = year === currentYear && month > currentMonth;
      const isPartial =
        year === currentYear && month === currentMonth && partialDay !== null;
      const throughDay = isPartial ? partialDay : null;
      const totals = isFuture
        ? { values: {}, orders: {}, other: 0 }
        : catalogueStackMonthTotals(
            year,
            month,
            throughDay,
            level,
            parentKey,
            nodeKeys,
            scale,
          );

      points.push({
        month: `${year}-${pad(month)}`,
        label: MONTH_LABELS[month - 1] as string,
        isFuture,
        isPartial,
        throughDay,
        values: totals.values,
        orders: totals.orders,
        other: hasOther ? totals.other : 0,
      });
    }

    return points;
  };

  return {
    level,
    parentKey,
    nodes,
    hasOther,
    years: [
      { year: twoYearsAgo, months: yearMonths(twoYearsAgo) },
      { year: previousYear, months: yearMonths(previousYear) },
      { year: currentYear, months: yearMonths(currentYear) },
    ],
  };
}

const AWAITING_DISPATCH_SET: ReadonlySet<StoreOrderState> = new Set(
  AWAITING_DISPATCH_STATES,
);

/**
 * A placed order that is real and paid but has not shipped yet. Exported so the
 * scorecard, the store connector, and their tests all read the lifecycle the same
 * way instead of each hard-coding its own list of state names.
 */
export function isAwaitingDispatch(state: StoreOrderState): boolean {
  return AWAITING_DISPATCH_SET.has(state);
}

function kpi(
  key: StoreKpi["key"],
  label: string,
  unit: StoreKpi["unit"],
  favorableDirection: StoreKpi["favorableDirection"],
  value: number | null,
  previousValue: number | null,
): StoreKpi {
  const normalise = unit === "percent" ? roundRate : round;

  return {
    key,
    label,
    unit,
    favorableDirection,
    value: value === null ? null : normalise(value),
    previousValue: previousValue === null ? null : normalise(previousValue),
  };
}

export interface StoreAnalyticsOptions {
  store?: StoreAnalyticsSnapshot["store"];
  /** Provenance label for the complete snapshot. Defaults to dummy. */
  mode?: StoreAnalyticsSnapshot["mode"];
  now?: Date;
  lastSuccessfulSyncAt?: Date;
  /** Volume multiplier so each brand reads at its own size. */
  scale?: number;
  /** False withholds every period-over-period read-out. Defaults to true. */
  comparisonEnabled?: boolean;
  /** Which baseline the reader chose. Defaults to the previous period. */
  comparisonWindow?: ComparisonWindow;
  /** Explicit baseline dates; only consulted when the window is "custom". */
  comparisonRange?: DateRange;
  /** Same-period paid-media estimate supplied by the dashboard aggregation layer. */
  estimatedBlendedCac?: number | null;
}

function customerCountryForStore(store: StoreAnalyticsSnapshot["store"]): string {
  const byTimezone: Record<string, string> = {
    "Asia/Jakarta": "ID",
    "Asia/Makassar": "ID",
    "Asia/Jayapura": "ID",
    "Asia/Singapore": "SG",
    "Asia/Kuala_Lumpur": "MY",
  };
  return byTimezone[store.timezone] ?? "ID";
}

const DEFAULT_STORE: StoreAnalyticsSnapshot["store"] = {
  id: "demo-store",
  name: "Demo store",
  currency: "USD" as Currency,
  timezone: "Asia/Jakarta",
  source: "demo",
};

/** The store follows the brand chosen in the account filter. */
export function storeForAccount(
  account: AccountOption,
): StoreAnalyticsSnapshot["store"] {
  return {
    id: `${account.slug}-store`,
    name: account.storeName,
    currency: account.currency,
    timezone: account.timezone,
    source: "demo",
  };
}

export function buildStoreAnalyticsSnapshot(
  range: DateRange,
  options: StoreAnalyticsOptions = {},
): StoreAnalyticsSnapshot {
  const store = options.store ?? DEFAULT_STORE;
  const scale = options.scale ?? 1;
  const now = options.now ?? new Date();
  const comparison = buildComparisonContext(
    range,
    options.comparisonEnabled ?? true,
    options.comparisonWindow ?? "previous",
    options.comparisonRange,
  );
  const comparisonRange = comparison.range;
  const orders = buildStoreOrders(range, scale);
  const sessions = buildStoreSessions(range, scale);
  const rfmLookbackRange = {
    start: addDays(range.end, -364),
    end: range.end,
  };
  const rfmOrders = buildStoreOrders(rfmLookbackRange, scale);
  // With comparison off nothing reads the baseline rows, so they are not built
  // at all rather than generated and then discarded.
  // The baseline is anchored to the end of the active period, not to its own
  // end date. Otherwise an older window would borrow today's in-flight tail and
  // report a warehouse backlog that has long since shipped.
  const previousOrders = comparison.enabled
    ? buildStoreOrders(comparisonRange, scale, range.end)
    : [];
  const previousSessions = comparison.enabled
    ? buildStoreSessions(comparisonRange, scale)
    : [];

  const grossSales = sum(orders.map((order) => order.grossSales));
  const previousGrossSales = sum(
    previousOrders.map((order) => order.grossSales),
  );
  const totalSales = sum(orders.map(totalSalesOf));
  const previousTotalSales = sum(previousOrders.map(totalSalesOf));
  const countState = (rows: StoreOrder[], match: (state: StoreOrderState) => boolean) =>
    rows.filter((order) => match(order.state)).length;

  const dispatched = countState(orders, (state) => state === "dispatched");
  const previousDispatched = countState(
    previousOrders,
    (state) => state === "dispatched",
  );
  const awaitingDispatch = countState(orders, isAwaitingDispatch);
  const previousAwaitingDispatch = countState(previousOrders, isAwaitingDispatch);
  const cancelled = countState(orders, (state) => state === "cancelled");
  const previousCancelled = countState(
    previousOrders,
    (state) => state === "cancelled",
  );
  const abandonedBaskets = buildAbandonedBaskets(orders);
  const previousAbandonedBaskets = buildAbandonedBaskets(previousOrders);
  const returning = orders.filter((order) => order.isReturningCustomer).length;
  const previousReturning = previousOrders.filter(
    (order) => order.isReturningCustomer,
  ).length;

  // Grouping once keeps a full-year range linear. Filtering the whole array per
  // day turned a 365 day request into hundreds of millions of comparisons.
  const ordersByDateIndex = groupByDate(orders);
  const previousOrdersByDateIndex = groupByDate(previousOrders);
  const sessionsByDateIndex = groupByDate(sessions);
  const previousSessionsByDateIndex = groupByDate(previousSessions);

  const ordersByDate = (index: Map<string, StoreOrder[]>, date: string) =>
    index.get(date) ?? [];
  const sessionsByDate = (index: Map<string, StoreSession[]>, date: string) =>
    index.get(date) ?? [];

  const kpis: StoreKpi[] = [
    kpi(
      "grossSales",
      "Gross sales",
      "currency",
      "higher",
      grossSales,
      baselineTotal(comparison, previousGrossSales),
    ),
    kpi(
      "returningCustomerRate",
      "Returning customer rate",
      "percent",
      "higher",
      safeDivide(returning, orders.length),
      baselineRatio(
        comparison,
        safeDivide(previousReturning, previousOrders.length),
      ),
    ),
    kpi(
      "orders",
      "Orders placed",
      "count",
      "higher",
      orders.length,
      baselineCount(comparison, previousOrders.length),
    ),
    kpi(
      "ordersDispatched",
      "Orders dispatched",
      "count",
      "higher",
      dispatched,
      baselineCount(comparison, previousDispatched),
    ),
    // Neutral on purpose: a backlog can mean strong demand or a slow warehouse,
    // so a rise here is not favourable or unfavourable on its own.
    kpi(
      "ordersAwaitingDispatch",
      "Awaiting dispatch",
      "count",
      "neutral",
      awaitingDispatch,
      baselineCount(comparison, previousAwaitingDispatch),
    ),
    kpi(
      "cancelledOrders",
      "Orders cancelled",
      "count",
      "lower",
      cancelled,
      baselineCount(comparison, previousCancelled),
    ),
    kpi(
      "abandonedBaskets",
      "Abandoned baskets",
      "count",
      "lower",
      abandonedBaskets,
      baselineCount(comparison, previousAbandonedBaskets),
    ),
    kpi(
      "totalSales",
      "Total sales",
      "currency",
      "higher",
      totalSales,
      baselineTotal(comparison, previousTotalSales),
    ),
    kpi(
      "sessions",
      "Sessions",
      "count",
      "higher",
      sessions.length,
      baselineCount(comparison, previousSessions.length),
    ),
    kpi(
      "conversionRate",
      "Conversion rate",
      "percent",
      "higher",
      safeDivide(
        sessions.filter((session) => session.completedCheckout).length,
        sessions.length,
      ),
      baselineRatio(
        comparison,
        safeDivide(
          previousSessions.filter((session) => session.completedCheckout).length,
          previousSessions.length,
        ),
      ),
    ),
    kpi(
      "averageOrderValue",
      "Average order value",
      "currency",
      "higher",
      safeDivide(totalSales, orders.length),
      baselineRatio(
        comparison,
        safeDivide(previousTotalSales, previousOrders.length),
      ),
    ),
  ];

  const netSales = sum(orders.map(netSalesOf));
  const salesBreakdown: BreakdownRow[] = [
    {
      key: "grossSales",
      label: "Gross sales",
      value: round(grossSales),
      previousValue: baselineTotal(comparison, previousGrossSales),
      isDeduction: false,
      isTotal: false,
    },
    {
      key: "discounts",
      label: "Discounts",
      value: round(sum(orders.map((order) => order.discounts))),
      previousValue: baselineTotal(
        comparison,
        sum(previousOrders.map((order) => order.discounts)),
      ),
      isDeduction: true,
      isTotal: false,
    },
    {
      key: "returns",
      label: "Returns",
      value: round(sum(orders.map((order) => order.returns))),
      previousValue: baselineTotal(
        comparison,
        sum(previousOrders.map((order) => order.returns)),
      ),
      isDeduction: true,
      isTotal: false,
    },
    {
      key: "netSales",
      label: "Net sales",
      value: round(netSales),
      previousValue: baselineTotal(
        comparison,
        sum(previousOrders.map(netSalesOf)),
      ),
      isDeduction: false,
      isTotal: false,
    },
    {
      key: "shippingCharges",
      label: "Shipping charges",
      value: round(sum(orders.map((order) => order.shippingCharges))),
      previousValue: baselineTotal(
        comparison,
        sum(previousOrders.map((order) => order.shippingCharges)),
      ),
      isDeduction: false,
      isTotal: false,
    },
    {
      key: "taxes",
      label: "Taxes",
      value: round(sum(orders.map((order) => order.taxes))),
      previousValue: baselineTotal(
        comparison,
        sum(previousOrders.map((order) => order.taxes)),
      ),
      isDeduction: false,
      isTotal: false,
    },
    {
      key: "totalSales",
      label: "Total sales",
      value: round(totalSales),
      previousValue: baselineTotal(comparison, previousTotalSales),
      isDeduction: false,
      isTotal: true,
    },
  ];

  const socialOrders = orders.filter((order) =>
    isSocialReferrer(order.referrerSource),
  );
  const previousSocialOrders = previousOrders.filter((order) =>
    isSocialReferrer(order.referrerSource),
  );
  const socialSessions = sessions.filter((session) =>
    isSocialReferrer(session.referrerSource),
  );
  const previousSocialSessions = previousSessions.filter((session) =>
    isSocialReferrer(session.referrerSource),
  );
  const rfm = buildRfmAnalysis(
    rfmOrders,
    range.end,
    rfmLookbackRange,
    customerCountryForStore(store),
  );
  const averageCustomerLifetimeValue = round(
    safeDivide(rfm.summary.totalSpent, rfm.summary.customerCount) ?? 0,
  );
  const estimatedBlendedCac = options.estimatedBlendedCac ?? null;

  return {
    mode: options.mode ?? "dummy",
    store,
    selectedRange: range,
    comparisonEnabled: comparison.enabled,
    comparisonRange,
    comparisonBasis: {
      label: comparison.label,
      activeDays: comparison.activeDays,
      comparisonDays: comparison.comparisonDays,
      normalisedToActiveDuration: comparison.normalised,
      alignedByDay: comparison.alignedByDay,
    },
    generatedAt: now.toISOString(),
    lastSuccessfulSync: (options.lastSuccessfulSyncAt ?? now).toISOString(),
    currencyNote: `Values are shown in ${store.currency} as reported by the store. Figures are never converted between currencies.`,
    kpis,
    salesOverTime: timeSeries(
      "totalSales",
      "Total sales over time",
      "currency",
      range,
      comparison,
      (date) => sum(ordersByDate(ordersByDateIndex, date).map(totalSalesOf)),
      (date) => sum(ordersByDate(previousOrdersByDateIndex, date).map(totalSalesOf)),
    ),
    averageOrderValueOverTime: timeSeries(
      "averageOrderValue",
      "Average order value over time",
      "currency",
      range,
      comparison,
      (date) => {
        const dayOrders = ordersByDate(ordersByDateIndex, date);
        return safeDivide(sum(dayOrders.map(totalSalesOf)), dayOrders.length) ?? 0;
      },
      (date) => {
        const dayOrders = ordersByDate(previousOrdersByDateIndex, date);
        return safeDivide(sum(dayOrders.map(totalSalesOf)), dayOrders.length) ?? 0;
      },
      false,
    ),
    sessionsOverTime: timeSeries(
      "sessions",
      "Sessions over time",
      "count",
      range,
      comparison,
      (date) => sessionsByDate(sessionsByDateIndex, date).length,
      (date) => sessionsByDate(previousSessionsByDateIndex, date).length,
    ),
    conversionRateOverTime: timeSeries(
      "conversionRate",
      "Conversion rate over time",
      "percent",
      range,
      comparison,
      (date) => {
        const daySessions = sessionsByDate(sessionsByDateIndex, date);
        return (
          safeDivide(
            daySessions.filter((session) => session.completedCheckout).length,
            daySessions.length,
          ) ?? 0
        );
      },
      (date) => {
        const daySessions = sessionsByDate(previousSessionsByDateIndex, date);
        return (
          safeDivide(
            daySessions.filter((session) => session.completedCheckout).length,
            daySessions.length,
          ) ?? 0
        );
      },
    ),
    salesBreakdown,
    salesByChannel: shareRows(
      orders,
      previousOrders,
      comparison,
      (order) => order.channel,
      totalSalesOf,
    ),
    catalogue: buildCatalogueBreakdown(orders, previousOrders, comparison),
    salesBySocialReferrer: shareRows(
      socialOrders,
      previousSocialOrders,
      comparison,
      (order) => order.referrerSource,
      totalSalesOf,
    ),
    salesByReferrer: shareRows(
      orders,
      previousOrders,
      comparison,
      (order) => order.referrerSource,
      totalSalesOf,
    ),
    sessionsByDevice: shareRows(
      sessions,
      previousSessions,
      comparison,
      (session) => session.device,
      () => 1,
    ),
    sessionsByLocation: shareRows(
      sessions,
      previousSessions,
      comparison,
      (session) => session.location,
      () => 1,
    ),
    sessionsByLandingPage: shareRows(
      sessions,
      previousSessions,
      comparison,
      (session) => session.landingPage,
      () => 1,
    ),
    sessionsBySocialReferrer: shareRows(
      socialSessions,
      previousSocialSessions,
      comparison,
      (session) => session.referrerSource,
      () => 1,
    ),
    conversionFunnel: funnelSteps(sessions, previousSessions, comparison),
    salesFunnel: funnelSteps(sessions, previousSessions, comparison, {
      averageOrderValue: safeDivide(totalSales, orders.length),
      realisedSales: totalSales,
    }),
    performanceByReferringChannel: channelPerformance(sessions, orders),
    rfm,
    unitEconomics: {
      averageCustomerLifetimeValue,
      estimatedBlendedCac,
      ltvToCacRatio:
        estimatedBlendedCac && estimatedBlendedCac > 0
          ? round(averageCustomerLifetimeValue / estimatedBlendedCac)
          : null,
    },
    cohorts: buildCohorts(range.end),
    yearlyPerformance: buildYearlyPerformance(range.end, scale),
  };
}
