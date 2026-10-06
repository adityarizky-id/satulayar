import type {
  Currency,
  DashboardDataMode,
  DashboardStorageMode,
  DateRange,
} from "@/lib/dashboard/types";

/**
 * Which dataset the reader is actually looking at, sent by
 * `/api/store-analytics` as a sibling of the snapshot rather than folded into
 * it.
 *
 * Deliberately separate from `StoreAnalyticsSnapshot.mode`. That field is
 * provenance for the STORE data and stays "dummy" until a store connector is connected,
 * because the GA4 bridge replaces traffic aggregates only — `rfm.customers`
 * remains fixture-generated, and `snapshot.mode` is what puts the SYNTHETIC-
 * prefix on the customer-match export. This one describes the ingestion mode
 * and whether live traffic actually landed.
 */
export interface StoreModeStatus {
  /** What the caller asked for, before the deployment had its say. */
  requested: DashboardDataMode | null;
  resolved: DashboardDataMode;
  storage: DashboardStorageMode;
  /**
   * True only when stored GA4 rows passed the bridge quality gate and replaced
   * the synthetic traffic figures. Live mode alone does not imply this: the
   * read fails soft, so an unreachable database or partial day coverage leaves
   * the figures entirely synthetic while the mode stays live.
   */
  liveTrafficApplied: boolean;
  /** Why live traffic is or is not in these figures, in reader-facing language. */
  reason: string | null;
}

/** The store-analytics response: the snapshot plus its sibling status keys. */
export interface StoreAnalyticsPayload extends StoreAnalyticsSnapshot {
  modeStatus?: StoreModeStatus;
}

export type StoreDevice = "Desktop" | "Mobile" | "Tablet" | "Other";

export type ReferringChannel =
  | "Direct"
  | "Paid"
  | "Organic"
  | "Social"
  | "Unknown";

/**
 * Lifecycle of a placed order, modelled on a typical warehouse-backed store's
 * order states. The enum has no
 * `refunded` member, and an order travels through the warehouse states below
 * before it reaches `dispatched`.
 *
 * `creating` is deliberately absent. In the store it marks a basket that never became
 * an order, so it belongs to a different population than the rows here and is
 * counted separately as an abandoned basket.
 */
export type StoreOrderState =
  | "submitted"
  | "in_warehouse"
  | "handling"
  | "handling_blocked"
  | "picked"
  | "packing"
  | "packed"
  | "finalised"
  | "dispatched"
  | "cancelled";

/**
 * Placed orders that are real and paid but have not left the warehouse yet.
 * Counting these as nothing understates recent days badly, because an order
 * needs time to travel to `dispatched`.
 */
export const AWAITING_DISPATCH_STATES = [
  "submitted",
  "in_warehouse",
  "handling",
  "handling_blocked",
  "picked",
  "packing",
  "packed",
  "finalised",
] as const satisfies readonly StoreOrderState[];

/** One dummy order line. Real rows will arrive from the store with the same shape. */
export interface StoreOrder {
  orderId: string;
  date: string;
  customerId: string;
  isReturningCustomer: boolean;
  state: StoreOrderState;
  channel: string;
  referrerSource: string;
  referringChannel: ReferringChannel;
  landingPage: string;
  device: StoreDevice;
  location: string;
  /** Stable catalogue identifier used by operator search and future store mapping. */
  productSku: string;
  productTitle: string;
  productFamily: string;
  productSubDepartment: string;
  productDepartment: string;
  grossSales: number;
  discounts: number;
  returns: number;
  shippingCharges: number;
  taxes: number;
}

export interface StoreSession {
  sessionId: string;
  date: string;
  device: StoreDevice;
  location: string;
  landingPage: string;
  referrerSource: string;
  referringChannel: ReferringChannel;
  addedToCart: boolean;
  reachedCheckout: boolean;
  completedCheckout: boolean;
}

export interface StoreKpi {
  key:
    | "grossSales"
    | "returningCustomerRate"
    | "orders"
    | "ordersDispatched"
    | "ordersAwaitingDispatch"
    | "cancelledOrders"
    | "abandonedBaskets"
    | "totalSales"
    | "sessions"
    | "conversionRate"
    | "averageOrderValue";
  label: string;
  value: number | null;
  /** Null when comparison is switched off; no delta is then reported. */
  previousValue: number | null;
  unit: "currency" | "count" | "percent";
  favorableDirection: "higher" | "lower" | "neutral";
}

export interface TimeSeriesPoint {
  date: string;
  value: number;
  /**
   * Null when comparison is off, and also when the baseline is a different
   * length than the active period: pairing day 1 of a 365-day baseline with
   * day 1 of a 14-day period would draw a line nobody asked for.
   */
  comparisonValue: number | null;
}

export interface TimeSeries {
  key: string;
  label: string;
  unit: "currency" | "count" | "percent";
  points: TimeSeriesPoint[];
  total: number | null;
  previousTotal: number | null;
}

export interface BreakdownRow {
  key: string;
  label: string;
  value: number;
  /** Null when comparison is off. Otherwise scaled to the active duration. */
  previousValue: number | null;
  /** Negative rows (discounts, returns) reduce the total. */
  isDeduction: boolean;
  isTotal: boolean;
}

export interface ShareRow {
  key: string;
  label: string;
  value: number;
  /** Null when comparison is off. Otherwise scaled to the active duration. */
  previousValue: number | null;
  share: number;
}

export interface FunnelStep {
  key: string;
  label: string;
  sessions: number;
  /** Null when comparison is off. Otherwise scaled to the active duration. */
  previousSessions: number | null;
  /** Share of the sessions that entered the funnel. */
  rateFromEntry: number;
  /** Share of the sessions that reached the previous step. */
  rateFromPreviousStep: number | null;
  /**
   * Sales value carried by the step. The final step holds realised sales; the
   * earlier steps hold the value still in play at that stage.
   */
  salesValue: number | null;
}

export interface ChannelPerformanceRow {
  channel: ReferringChannel;
  sessions: number;
  orders: number;
  totalSales: number;
  conversionRate: number | null;
  averageOrderValue: number | null;
}

/**
 * the store's product taxonomy is four layers deep, department at the top and
 * product (SKU) at the bottom. Each layer gets its own URL slug in the store, so
 * every node carries one now even though this dummy build has nowhere to
 * link it yet.
 */
export type CatalogueLevel = "department" | "subDepartment" | "family" | "product";

export interface CatalogueNode {
  /** Unique across the whole breakdown: the full path from department down. */
  key: string;
  /** This node's own path segment, ready for a future per-node page. */
  slug: string;
  /** Stable, human-readable drill identifier composed from every parent slug. */
  path: string;
  label: string;
  /** Present only for product nodes; parent taxonomy levels do not have a SKU. */
  sku?: string | null;
  level: CatalogueLevel;
  /** Null only for a department, which has no layer above it. */
  parentKey: string | null;
  orders: number;
  /** Null when comparison is off. Otherwise scaled to the active duration. */
  previousOrders: number | null;
  value: number;
  previousValue: number | null;
  /** Share of the total among siblings under the same parent. */
  share: number;
}

export interface CatalogueBreakdown {
  department: CatalogueNode[];
  subDepartment: CatalogueNode[];
  family: CatalogueNode[];
  product: CatalogueNode[];
}

export interface CatalogueStackMonth {
  month: string;
  label: string;
  /** True when the calendar slot is after the latest available store date. */
  isFuture: boolean;
  isPartial: boolean;
  throughDay: number | null;
  /** Value per node key, keyed the same as `CatalogueStack.nodes[].key`. */
  values: Record<string, number>;
  /** Order count per node key, keyed the same as `CatalogueStack.nodes[].key`. */
  orders?: Record<string, number>;
  /** Everything outside the tracked node set for this level and scope. */
  other: number;
}

export interface CatalogueStackYear {
  year: number;
  /** Twelve calendar slots, January first; future current-year slots carry no values. */
  months: CatalogueStackMonth[];
}

export interface CatalogueStack {
  level: CatalogueLevel;
  /** The parent node this stack is scoped to, null at department level. */
  parentKey: string | null;
  /** The fixed legend tracked across every month and year, ranked by value. */
  nodes: Pick<CatalogueNode, "key" | "slug" | "label">[];
  /** False at department level: every department is tracked, none left over. */
  hasOther: boolean;
  /** Three years, oldest first, matching the yearly performance chart. */
  years: CatalogueStackYear[];
}

export interface CohortRow {
  cohort: string;
  customers: number;
  /** Retention share per month index, starting at month 0. */
  retention: number[];
}

export type RfmSegmentKey =
  | "previouslyLoyal"
  | "atRisk"
  | "dormant"
  | "loyal"
  | "champions"
  | "needsAttention"
  | "almostLost"
  | "active"
  | "promising"
  | "new";

export type RfmMetricKey =
  | "customerShare"
  | "customerCount"
  | "averageRecencyDays"
  | "totalOrders"
  | "totalSpent";

export interface RfmSegmentRow {
  key: RfmSegmentKey;
  label: string;
  customerShare: number;
  customerCount: number;
  averageRecencyDays: number;
  totalOrders: number;
  totalSpent: number;
}

export interface CustomerRfmRow {
  customerId: string;
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  /** International phone number in E.164 form. */
  phone: string;
  zip: string;
  /** ISO 3166-1 alpha-2 country code. */
  country: string;
  company: string;
  segmentKey: RfmSegmentKey;
  segmentLabel: string;
  recencyDays: number;
  lastOrderDate: string;
  frequency: number;
  monetary: number;
  aov: number;
  topCategory: string;
  statusTag: string;
  recencyScore: number;
  frequencyScore: number;
  monetaryScore: number;
}

export interface RfmAnalysis {
  asOfDate: string;
  lookbackRange: DateRange;
  /** Stable internal keys stay separate from source-specific display labels. */
  fieldLabels: Record<"segment" | RfmMetricKey, string>;
  summary: Omit<RfmSegmentRow, "key" | "label">;
  segments: RfmSegmentRow[];
  customers: CustomerRfmRow[];
}

export interface MonthlySalesPoint {
  month: string;
  label: string;
  sales: number;
  orders: number;
  isPartial: boolean;
  /** Day of month the partial figure stops at, null for a complete month. */
  throughDay: number | null;
}

export interface MonthlyComparisonRow {
  month: string;
  label: string;
  currentSales: number;
  currentOrders: number;
  previousSales: number;
  previousOrders: number;
  salesDeltaPercent: number | null;
  ordersDeltaPercent: number | null;
  isPartial: boolean;
  throughDay: number | null;
}

export interface YearlyComparisonSeries {
  year: number;
  /**
   * Calendar-month points used by the combined chart. When the current month
   * is partial, the matching month in every year stops on the same day.
   */
  months: MonthlySalesPoint[];
}

export interface YearlyPerformance {
  currentYear: number;
  previousYear: number;
  twoYearsAgo: number;
  twoYearsAgoMonths: MonthlySalesPoint[];
  previousYearMonths: MonthlySalesPoint[];
  currentYearMonths: MonthlySalesPoint[];
  /** Current year plus the two prior years, oldest first. */
  comparisonYears: YearlyComparisonSeries[];
  /** Like-for-like: a partial month is matched against the same days a year ago. */
  comparison: MonthlyComparisonRow[];
  ytd: {
    label: string;
    currentSales: number;
    currentOrders: number;
    previousSales: number;
    previousOrders: number;
    salesDeltaPercent: number | null;
    ordersDeltaPercent: number | null;
  };
  bestMonth: MonthlySalesPoint | null;
  note: string;
}

export interface StoreAnalyticsSnapshot {
  mode: "dummy" | "live";
  store: {
    id: string;
    name: string;
    currency: Currency;
    timezone: string;
    source: "demo";
  };
  selectedRange: DateRange;
  /**
   * False when the reader switched comparison off in the reporting-period
   * picker. Every period-over-period read-out is then withheld instead of
   * being measured against a baseline nobody chose; `comparisonRange` still
   * names the window that would be used, and the UI says so.
   */
  comparisonEnabled: boolean;
  comparisonRange: DateRange;
  comparisonBasis: {
    /** The chosen window's name, or "No comparison" when it is switched off. */
    label: string;
    activeDays: number;
    comparisonDays: number;
    /** True when additive baseline figures are scaled to the active duration. */
    normalisedToActiveDuration: boolean;
    /**
     * True when both periods run the same number of days, which is the only
     * case where a day-by-day baseline line can be drawn honestly.
     */
    alignedByDay: boolean;
  };
  generatedAt: string;
  lastSuccessfulSync: string;
  /** Currency is shown as reported by the store and never converted. */
  currencyNote: string;
  kpis: StoreKpi[];
  salesOverTime: TimeSeries;
  averageOrderValueOverTime: TimeSeries;
  sessionsOverTime: TimeSeries;
  conversionRateOverTime: TimeSeries;
  salesBreakdown: BreakdownRow[];
  salesByChannel: ShareRow[];
  catalogue: CatalogueBreakdown;
  salesBySocialReferrer: ShareRow[];
  salesByReferrer: ShareRow[];
  sessionsByDevice: ShareRow[];
  sessionsByLocation: ShareRow[];
  sessionsByLandingPage: ShareRow[];
  sessionsBySocialReferrer: ShareRow[];
  conversionFunnel: FunnelStep[];
  salesFunnel: FunnelStep[];
  performanceByReferringChannel: ChannelPerformanceRow[];
  rfm: RfmAnalysis;
  unitEconomics: {
    /** Trailing-12-month customer value from the same RFM population. */
    averageCustomerLifetimeValue: number;
    /** Paid-media spend per realised store order; null until supplied by that layer. */
    estimatedBlendedCac: number | null;
    ltvToCacRatio: number | null;
  };
  cohorts: CohortRow[];
  yearlyPerformance: YearlyPerformance;
}
