import { enumerateDates } from "@/lib/dashboard/data-quality";
import type { DateRange } from "@/lib/dashboard/types";
import type {
  ReferringChannel,
  StoreDevice,
  StoreOrder,
  StoreOrderState,
  StoreSession,
} from "@/lib/store/types";

/**
 * Synthetic store data. Values are deterministic for a given date so the
 * server and the client always render the same numbers, and so tests can
 * assert exact figures. No real customer, order, or revenue data lives here.
 */

const PRODUCTS = [
  {
    sku: "KOP-ARB-GY-01",
    title: "Arabica Gayo Single Origin · 250g",
    family: "Single Origin Beans",
    subDepartment: "Whole Bean Coffee",
    department: "Coffee",
    price: 18,
  },
  {
    sku: "KOP-ARB-TJ-02",
    title: "Arabica Toraja Kalosi · 250g",
    family: "Single Origin Beans",
    subDepartment: "Whole Bean Coffee",
    department: "Coffee",
    price: 19,
  },
  {
    sku: "KOP-DRP-MX-03",
    title: "Drip Bag Sampler · 10 pack",
    family: "Drip Bags",
    subDepartment: "Brewing Kits",
    department: "Coffee",
    price: 12,
  },
  {
    sku: "BTK-KAI-PR-04",
    title: "Batik Tulis Cloth · Parang 2m",
    family: "Batik Cloth",
    subDepartment: "Batik Textiles",
    department: "Batik & Textiles",
    price: 64,
  },
  {
    sku: "BTK-SHR-MM-05",
    title: "Batik Cap Shirt · Mega Mendung",
    family: "Batik Shirts",
    subDepartment: "Batik Apparel",
    department: "Batik & Textiles",
    price: 38,
  },
  {
    sku: "RJT-CRD-CR-06",
    title: "Hand-knit Cardigan · Cream",
    family: "Cardigans",
    subDepartment: "Knitwear",
    department: "Batik & Textiles",
    price: 45,
  },
  {
    sku: "JMU-KNY-AS-07",
    title: "Kunyit Asam Jamu · 6 bottles",
    family: "Ready-to-drink Jamu",
    subDepartment: "Herbal Drinks",
    department: "Wellness",
    price: 14,
  },
  {
    sku: "JMU-BRS-KC-08",
    title: "Beras Kencur Powder · 200g",
    family: "Jamu Powders",
    subDepartment: "Herbal Drinks",
    department: "Wellness",
    price: 9,
  },
  {
    sku: "KRY-RTN-LG-09",
    title: "Rattan Woven Basket · Large",
    family: "Woven Baskets",
    subDepartment: "Rattan & Bamboo",
    department: "Home & Craft",
    price: 28,
  },
  {
    sku: "KRY-TRC-UB-10",
    title: "Ubud Terracotta Vase · 23cm",
    family: "Vases",
    subDepartment: "Tabletop Accents",
    department: "Home & Craft",
    price: 26,
  },
] as const;

const CHANNELS = [
  "Online Store",
  "Google & YouTube",
  "Reseller Portal",
  "Agentic",
] as const;

const REFERRERS: {
  source: string;
  channel: ReferringChannel;
  isSocial: boolean;
}[] = [
  { source: "direct", channel: "Direct", isSocial: false },
  { source: "google", channel: "Organic", isSocial: false },
  { source: "google ads", channel: "Paid", isSocial: false },
  { source: "facebook", channel: "Social", isSocial: true },
  { source: "instagram", channel: "Social", isSocial: true },
  { source: "pinterest", channel: "Social", isSocial: true },
  { source: "none", channel: "Unknown", isSocial: false },
];

const LANDING_PAGES = [
  "/products/arabica-gayo-single-origin-250g",
  "/collections/batik-and-textiles",
  "/products/kunyit-asam-jamu-6-bottles",
  "/collections/all",
  "/products/ubud-terracotta-vase-23cm",
  "/pages/reseller",
] as const;

const DEVICES: StoreDevice[] = ["Desktop", "Mobile", "Tablet", "Other"];

const LOCATIONS = [
  "Indonesia · DKI Jakarta · Jakarta",
  "Indonesia · West Java · Bandung",
  "Indonesia · East Java · Surabaya",
  "Indonesia · Bali · Denpasar",
  "Malaysia · Kuala Lumpur · Kuala Lumpur",
  "Singapore · Singapore · Singapore",
] as const;

/** Small deterministic PRNG so a date always produces the same store day. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function seedFromDate(date: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < date.length; index += 1) {
    hash ^= date.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function pick<T>(items: readonly T[], random: () => number): T {
  return items[Math.floor(random() * items.length)] as T;
}

function weightedIndex(weights: readonly number[], random: () => number) {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = random() * total;
  for (let index = 0; index < weights.length; index += 1) {
    cursor -= weights[index] as number;
    if (cursor <= 0) return index;
  }
  return weights.length - 1;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function dayOfWeekLift(date: string): number {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  // Weekends are quieter for this store.
  return weekday === 0 || weekday === 6 ? 0.72 : 1.08;
}

const MONTH_LIFT = [
  0.92, 0.9, 0.97, 1.02, 0.88, 1.05, 0.95, 0.9, 1, 1.18, 1.24, 1.45,
] as const;

/** Retail peaks into year-end, so the dummy year has a shape worth reading. */
function seasonalLift(date: string): number {
  const monthIndex = Number(date.slice(5, 7)) - 1;
  return MONTH_LIFT[monthIndex] ?? 1;
}

/** A fixed year-on-year trend so the yearly comparison shows real movement. */
function yearLift(date: string): number {
  const year = Number(date.slice(0, 4));
  if (year >= 2026) return 1.09;
  return 1;
}

function demandLift(date: string): number {
  return dayOfWeekLift(date) * seasonalLift(date) * yearLift(date);
}

/**
 * Share of placed orders still working through the warehouse, by the age of the
 * order. The synthetic curve treats the same-day share as effectively total,
 * puts the previous day near two thirds,
 * and lets the tail settle around four percent after a few days.
 */
function awaitingDispatchShare(ageInDays: number): number {
  if (ageInDays <= 0) return 0.94;
  if (ageInDays === 1) return 0.62;
  if (ageInDays === 2) return 0.18;
  if (ageInDays === 3) return 0.08;
  return 0.04;
}

/** Synthetic spread of in-flight orders across the warehouse states. */
const AWAITING_DISPATCH_MIX = [
  ["in_warehouse", 0.68],
  ["handling", 0.11],
  ["submitted", 0.09],
  ["picked", 0.04],
  ["packing", 0.03],
  ["packed", 0.03],
  ["finalised", 0.015],
  ["handling_blocked", 0.005],
] as const satisfies readonly (readonly [StoreOrderState, number])[];

const CANCELLED_SHARE = 0.02;

/**
 * Maps one uniform draw to a lifecycle state. Taking a single draw keeps the
 * fixture's random stream identical to the boolean this replaced, so no
 * unrelated dummy value shifts.
 */
export function resolveOrderState(
  roll: number,
  ageInDays: number,
): StoreOrderState {
  if (roll < CANCELLED_SHARE) return "cancelled";

  const awaiting = awaitingDispatchShare(ageInDays);
  if (roll >= CANCELLED_SHARE + awaiting) return "dispatched";

  let offset = (roll - CANCELLED_SHARE) / awaiting;
  for (const [state, weight] of AWAITING_DISPATCH_MIX) {
    if (offset < weight) return state;
    offset -= weight;
  }
  return "in_warehouse";
}

function daysBefore(date: string, asOf: string): number {
  return Math.round(
    (Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) /
      86_400_000,
  );
}

/**
 * `asOf` anchors the lifecycle: orders near it are still in the warehouse, older
 * ones have shipped. It defaults to the end of the requested range so a baseline
 * period reads as fully settled rather than borrowing today's in-flight tail.
 */
export function buildStoreOrders(
  range: DateRange,
  scale = 1,
  asOf: string = range.end,
): StoreOrder[] {
  const orders: StoreOrder[] = [];

  for (const date of enumerateDates(range)) {
    const random = createRandom(seedFromDate(`orders:${date}`));
    const orderCount = Math.max(
      2,
      Math.round((6 + random() * 7) * demandLift(date) * scale),
    );

    for (let index = 0; index < orderCount; index += 1) {
      const product = PRODUCTS[
        weightedIndex([16, 13, 9, 12, 10, 8, 7, 9, 11, 5], random)
      ] as (typeof PRODUCTS)[number];
      const referrer = REFERRERS[
        weightedIndex([24, 18, 16, 14, 12, 6, 10], random)
      ] as (typeof REFERRERS)[number];
      const quantity = 1 + Math.floor(random() * 3);
      const grossSales = round(product.price * quantity);
      const discounts = random() < 0.28 ? round(grossSales * 0.12) : 0;
      const returns = random() < 0.06 ? round(grossSales * 0.5) : 0;
      const shippingCharges = grossSales > 120 ? 0 : round(4.5 + random() * 3);
      const netSales = grossSales - discounts - returns;

      orders.push({
        orderId: `dummy-${date}-${index + 1}`,
        date,
        customerId: `dummy-customer-${Math.floor(random() * 420) + 1}`,
        isReturningCustomer: random() < 0.31,
        state: resolveOrderState(random(), daysBefore(date, asOf)),
        channel: CHANNELS[weightedIndex([62, 18, 12, 8], random)] as string,
        referrerSource: referrer.source,
        referringChannel: referrer.channel,
        landingPage: pick(LANDING_PAGES, random),
        device: DEVICES[weightedIndex([44, 41, 12, 3], random)] as StoreDevice,
        location: LOCATIONS[
          weightedIndex([34, 14, 11, 16, 13, 12], random)
        ] as string,
        productSku: product.sku,
        productTitle: product.title,
        productFamily: product.family,
        productSubDepartment: product.subDepartment,
        productDepartment: product.department,
        grossSales,
        discounts,
        returns,
        shippingCharges,
        taxes: round(Math.max(netSales, 0) * 0.2),
      });
    }
  }

  return orders;
}

/**
 * Baskets that never became orders — the store's `creating` rows. They are a separate
 * population from placed orders, so they are counted alongside the orders array
 * rather than mixed into it, and they must never be read as lost sales revenue.
 */
export function buildAbandonedBaskets(orders: StoreOrder[]): number {
  const placedByDate = new Map<string, number>();
  for (const order of orders) {
    placedByDate.set(order.date, (placedByDate.get(order.date) ?? 0) + 1);
  }

  let total = 0;
  for (const [date, placed] of placedByDate) {
    const random = createRandom(seedFromDate(`baskets:${date}`));
    total += Math.round(placed * (0.42 + random() * 0.26));
  }

  return total;
}

export function buildStoreSessions(range: DateRange, scale = 1): StoreSession[] {
  const sessions: StoreSession[] = [];

  for (const date of enumerateDates(range)) {
    const random = createRandom(seedFromDate(`sessions:${date}`));
    const sessionCount = Math.round(
      (210 + random() * 90) * demandLift(date) * scale,
    );

    for (let index = 0; index < sessionCount; index += 1) {
      const referrer = REFERRERS[
        weightedIndex([22, 20, 15, 15, 13, 7, 8], random)
      ] as (typeof REFERRERS)[number];
      const addedToCart = random() < 0.19;
      const reachedCheckout = addedToCart && random() < 0.42;
      const completedCheckout = reachedCheckout && random() < 0.61;

      sessions.push({
        sessionId: `dummy-session-${date}-${index + 1}`,
        date,
        device: DEVICES[weightedIndex([46, 43, 9, 2], random)] as StoreDevice,
        location: LOCATIONS[
          weightedIndex([33, 15, 12, 15, 13, 12], random)
        ] as string,
        landingPage: pick(LANDING_PAGES, random),
        referrerSource: referrer.source,
        referringChannel: referrer.channel,
        addedToCart,
        reachedCheckout,
        completedCheckout,
      });
    }
  }

  return sessions;
}

export function isSocialReferrer(source: string): boolean {
  return REFERRERS.some(
    (referrer) => referrer.source === source && referrer.isSocial,
  );
}

/**
 * Retention is generated for the eight months before the selected range so the
 * cohort grid keeps its shape regardless of the chosen timeframe.
 */
export function buildCohortMonths(rangeEnd: string): string[] {
  const end = new Date(`${rangeEnd.slice(0, 7)}-01T00:00:00Z`);
  const months: string[] = [];

  for (let offset = 7; offset >= 0; offset -= 1) {
    const cursor = new Date(end);
    cursor.setUTCMonth(cursor.getUTCMonth() - offset);
    months.push(cursor.toISOString().slice(0, 7));
  }

  return months;
}
