import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BarList } from "../src/components/charts/bar-list";

test("composition bars show their share of the whole and give zero no visible fill", () => {
  const markup = renderToStaticMarkup(createElement(BarList, {
    rows: [
      { key: "coffee", label: "Coffee", value: 42, previousValue: null, share: 0.42 },
      { key: "none", label: "No sales", value: 0, previousValue: null, share: 0 },
    ],
    formatValue: String,
    formatChange: () => "No comparison",
    scale: "share",
    showShare: true,
  }));
  assert.match(markup, /width:42%/);
  assert.match(markup, /width:0%/);
  assert.match(markup, /42\.0%/);
  assert.doesNotMatch(markup, /width:100%/);
});

import {
  buildStackedSegmentTooltip,
  getStackedMonthCentre,
  StackedBarChart,
} from "../src/components/charts/stacked-bar-chart";
import {
  buildJourneyCards,
  groupCardsByStage,
  JOURNEY_TREND_METRICS,
} from "../src/lib/dashboard/scorecard";
import { aggregateMetrics } from "../src/lib/dashboard/kpi";
import {
  CATALOGUE_TOP_COUNT,
  buildCatalogueStack,
  buildStoreAnalyticsSnapshot,
  catalogueRowsForDisplay,
  isAwaitingDispatch,
  netSalesOf,
  storeForAccount,
  totalSalesOf,
} from "../src/lib/store/analytics";
import {
  buildStoreOrders,
  buildStoreSessions,
  resolveOrderState,
} from "../src/lib/store/fixtures";
import { AWAITING_DISPATCH_STATES } from "../src/lib/store/types";
import { ACCOUNT_OPTIONS } from "../src/lib/dashboard/accounts";
import type { DailyMetric } from "../src/lib/dashboard/types";
import type { StoreOrder } from "../src/lib/store/types";

const RANGE = { start: "2026-07-01", end: "2026-07-14" };

const baseRow: DailyMetric = {
  date: "2026-07-01",
  clientId: "demo",
  accountId: "demo",
  platform: "meta",
  currency: "GBP",
  accountTimezone: "Europe/London",
  spend: 200,
  impressions: 20_000,
  clicks: 400,
  landingPageViews: 320,
  registrations: 40,
  purchases: 8,
  platformConversionValue: 900,
  actualPurchaseRevenue: 720,
  sourceConnector: "mock",
  sourceQueryVersion: "fixture-v1",
  syncedAt: "2026-07-15T00:00:00.000Z",
  isProvisional: false,
};

test("journey metrics are derived from totals, not stored per row", () => {
  const totals = aggregateMetrics([baseRow]);

  assert.equal(totals.ctr, 0.02);
  assert.equal(totals.cpc, 0.5);
  assert.equal(totals.cpm, 10);
  assert.equal(totals.costPerLandingPageView, 0.625);
  assert.equal(totals.lpvToRegistrationRate, 0.125);
  assert.equal(totals.registrationToPurchaseRate, 0.2);
  assert.equal(totals.clickToPurchaseRate, 0.02);
  assert.equal(totals.averageOrderValue, 90);
  assert.equal(totals.costPerPurchase, 25);
});

test("a zero denominator never fabricates a rate", () => {
  const totals = aggregateMetrics([
    { ...baseRow, impressions: 0, clicks: 0, registrations: 0, purchases: 0 },
  ]);

  assert.equal(totals.ctr, null);
  assert.equal(totals.cpm, null);
  assert.equal(totals.cpc, null);
  assert.equal(totals.registrationToPurchaseRate, null);
  assert.equal(totals.averageOrderValue, null);
});

test("the scorecard is ordered by customer journey and every card carries a comparison", () => {
  const totals = aggregateMetrics([baseRow]);
  const comparison = aggregateMetrics([{ ...baseRow, spend: 150 }]);
  const cards = buildJourneyCards(totals, comparison, "fixture-v1", "all");
  const groups = groupCardsByStage(cards);

  assert.deepEqual(
    groups.map((group) => group.definition.stage),
    [
      "investment",
      "reach",
      "engagement",
      "consideration",
      "acquisition",
      "revenue",
    ],
  );
  assert.equal(
    cards.every((card) => card.previousValue !== undefined),
    true,
  );
  assert.equal(
    cards.every((card) => card.evidenceId.endsWith(":fixture-v1")),
    true,
  );
  assert.equal(
    cards.find((card) => card.key === "cpc")?.favorableDirection,
    "lower",
  );
  assert.equal(
    cards.find((card) => card.key === "ctr")?.unit,
    "percent",
  );
});

test("delivery trend exposes the requested Customer Journey metric groups", () => {
  assert.deepEqual(
    JOURNEY_TREND_METRICS.map((metric) => [
      metric.stage,
      metric.label,
      metric.unit,
    ]),
    [
      ["investment", "Spend", "currency"],
      ["reach", "Impressions", "count"],
      ["reach", "CPM", "currency"],
      ["reach", "Reach per day", "count"],
      ["engagement", "Clicks", "count"],
      ["engagement", "CTR", "percent"],
      ["engagement", "CPC", "currency"],
      ["consideration", "Page views", "count"],
      ["consideration", "Cost per page view", "currency"],
      ["consideration", "Page view rate", "percent"],
      ["consideration", "Engaged visits", "count"],
      ["consideration", "Add to basket", "count"],
      ["consideration", "Cost per basket", "currency"],
      ["acquisition", "Registrations", "count"],
      ["acquisition", "CPA · cost per acquisition", "currency"],
      ["acquisition", "Purchases", "count"],
      ["acquisition", "CPO · cost per order", "currency"],
      ["acquisition", "Conversion rate", "percent"],
      ["revenue", "Revenue", "currency"],
      ["revenue", "Average order value", "currency"],
      ["revenue", "ROAS", "ratio"],
    ],
  );
});

test("cross-platform scope keeps the attributed-purchase label", () => {
  const totals = aggregateMetrics([baseRow]);
  const combined = buildJourneyCards(totals, totals, "fixture-v1", "all");
  const single = buildJourneyCards(totals, totals, "fixture-v1", "meta");

  assert.equal(
    combined.find((card) => card.key === "purchases")?.label,
    "Platform-attributed purchases",
  );
  assert.equal(
    single.find((card) => card.key === "purchases")?.label,
    "Purchases",
  );
});

test("dummy store rows are deterministic for the same date", () => {
  const first = buildStoreOrders(RANGE);
  const second = buildStoreOrders(RANGE);
  const sessions = buildStoreSessions(RANGE);

  assert.deepEqual(first, second);
  assert.deepEqual(buildStoreSessions(RANGE), sessions);
  assert.equal(first.length > 0, true);
  assert.equal(sessions.length > 0, true);
});

test("store sales arithmetic keeps net and total sales consistent", () => {
  const [order] = buildStoreOrders({ start: "2026-07-01", end: "2026-07-01" });

  assert.notEqual(order, undefined);
  if (!order) return;

  assert.equal(
    netSalesOf(order),
    order.grossSales - order.discounts - order.returns,
  );
  assert.equal(
    totalSalesOf(order),
    netSalesOf(order) + order.shippingCharges + order.taxes,
  );
});

test("the store snapshot reports every widget the page renders", () => {
  const snapshot = buildStoreAnalyticsSnapshot(RANGE, {
    now: new Date("2026-08-05T00:00:00.000Z"),
  });

  assert.equal(snapshot.mode, "dummy");
  assert.equal(snapshot.store.source, "demo");
  assert.deepEqual(snapshot.comparisonRange, {
    start: "2026-06-17",
    end: "2026-06-30",
  });
  assert.equal(snapshot.salesOverTime.points.length, 14);
  assert.equal(snapshot.sessionsOverTime.points.length, 14);
  assert.equal(snapshot.conversionRateOverTime.points.length, 14);
  assert.equal(snapshot.averageOrderValueOverTime.points.length, 14);

  for (const rows of [
    snapshot.salesByChannel,
    snapshot.salesByReferrer,
    snapshot.salesBySocialReferrer,
    snapshot.sessionsByDevice,
    snapshot.sessionsByLocation,
    snapshot.sessionsByLandingPage,
    snapshot.sessionsBySocialReferrer,
    snapshot.catalogue.department,
    snapshot.catalogue.subDepartment,
    snapshot.catalogue.family,
    snapshot.catalogue.product,
  ]) {
    assert.equal(rows.length > 0, true);
    assert.equal(
      rows.every(
        (row) =>
          row.value >= 0 && row.previousValue !== null && row.previousValue >= 0,
      ),
      true,
    );
  }

  assert.equal(snapshot.performanceByReferringChannel.length, 5);
  assert.equal(snapshot.rfm.segments.length, 10);
  assert.equal(snapshot.cohorts.length, 8);
  assert.equal(snapshot.conversionFunnel.length, 4);
  assert.equal(snapshot.salesFunnel.length, 4);
});

test("the store snapshot preserves an explicitly selected live data mode", () => {
  const snapshot = buildStoreAnalyticsSnapshot(RANGE, { mode: "live" });

  assert.equal(snapshot.mode, "live");
});

test("the sales breakdown adds up to total sales", () => {
  const snapshot = buildStoreAnalyticsSnapshot(RANGE);
  const rowFor = (key: string) =>
    snapshot.salesBreakdown.find((row) => row.key === key)?.value ?? 0;

  const netSales = rowFor("grossSales") - rowFor("discounts") - rowFor("returns");
  const totalSales = netSales + rowFor("shippingCharges") + rowFor("taxes");

  assert.equal(Math.abs(rowFor("netSales") - netSales) < 0.05, true);
  assert.equal(Math.abs(rowFor("totalSales") - totalSales) < 0.05, true);
  assert.equal(
    snapshot.salesBreakdown.filter((row) => row.isTotal).length,
    1,
  );
});

test("the conversion funnel never widens as it goes down", () => {
  const snapshot = buildStoreAnalyticsSnapshot(RANGE);
  const counts = snapshot.conversionFunnel.map((step) => step.sessions);

  for (let index = 1; index < counts.length; index += 1) {
    assert.equal((counts[index] ?? 0) <= (counts[index - 1] ?? 0), true);
  }
  assert.equal(snapshot.conversionFunnel[0]?.rateFromEntry, 1);
  assert.equal(snapshot.conversionFunnel[0]?.rateFromPreviousStep, null);
});

test("the sales funnel ends on realised sales, not an estimate", () => {
  const snapshot = buildStoreAnalyticsSnapshot(RANGE);
  const finalStep = snapshot.salesFunnel.at(-1);
  const totalSales = snapshot.salesBreakdown.find(
    (row) => row.key === "totalSales",
  )?.value;

  assert.equal(finalStep?.key, "completedCheckout");
  assert.equal(finalStep?.salesValue, totalSales);
  assert.equal(
    snapshot.conversionFunnel.every((step) => step.salesValue === null),
    true,
  );
});

test("store KPIs carry a comparison and the store currency is never converted", () => {
  const snapshot = buildStoreAnalyticsSnapshot(RANGE);

  assert.deepEqual(
    snapshot.kpis.map((item) => item.key),
    [
      "grossSales",
      "returningCustomerRate",
      "orders",
      "ordersDispatched",
      "ordersAwaitingDispatch",
      "cancelledOrders",
      "abandonedBaskets",
      "totalSales",
      "sessions",
      "conversionRate",
      "averageOrderValue",
    ],
  );
  assert.equal(
    snapshot.kpis.every((item) => item.previousValue !== null),
    true,
  );
  assert.match(snapshot.currencyNote, /never converted/i);
  assert.equal(snapshot.store.currency, "USD");
});

test("rate KPIs keep sub-percent precision instead of flattening to zero", () => {
  const snapshot = buildStoreAnalyticsSnapshot(RANGE);
  const conversionRate = snapshot.kpis.find(
    (item) => item.key === "conversionRate",
  );
  const completed = snapshot.conversionFunnel.at(-1);
  const sessions = snapshot.conversionFunnel[0];

  assert.notEqual(conversionRate?.value, null);
  assert.equal(
    Math.abs(
      (conversionRate?.value ?? 0) -
        (completed?.sessions ?? 0) / (sessions?.sessions ?? 1),
    ) < 0.000_01,
    true,
  );
  // A two-decimal round would have snapped this to a multiple of 0.01.
  assert.notEqual(
    Math.round((conversionRate?.value ?? 0) * 100) / 100,
    conversionRate?.value,
  );
});

test("store sync time is separate from snapshot render time", () => {
  const renderedAt = new Date("2026-08-07T04:00:00.000Z");
  const syncedAt = new Date("2026-08-07T03:45:00.000Z");
  const snapshot = buildStoreAnalyticsSnapshot(RANGE, {
    now: renderedAt,
    lastSuccessfulSyncAt: syncedAt,
  });

  assert.equal(snapshot.generatedAt, renderedAt.toISOString());
  assert.equal(snapshot.lastSuccessfulSync, syncedAt.toISOString());
});
test("the order lifecycle states add up to orders placed", () => {
  const snapshot = buildStoreAnalyticsSnapshot(RANGE);
  const valueOf = (key: string) =>
    snapshot.kpis.find((item) => item.key === key)?.value ?? 0;

  const orders = valueOf("orders");
  const dispatched = valueOf("ordersDispatched");
  const awaiting = valueOf("ordersAwaitingDispatch");
  const cancelled = valueOf("cancelledOrders");

  assert.equal(dispatched <= orders, true);
  // Every placed order lands in exactly one of the three buckets. This is the
  // guard against the connector defect where in-flight states matched no branch
  // and silently vanished from the totals.
  assert.equal(dispatched + awaiting + cancelled, orders);
});

test("abandoned baskets are counted apart from placed orders", () => {
  const snapshot = buildStoreAnalyticsSnapshot(RANGE);
  const baskets = snapshot.kpis.find((item) => item.key === "abandonedBaskets");

  assert.notEqual(baskets, undefined);
  assert.equal(baskets?.unit, "count");
  // A basket is not a sale, so a rise in them is unfavourable.
  assert.equal(baskets?.favorableDirection, "lower");
  assert.equal((baskets?.value ?? 0) > 0, true);
});

test("a backlog is reported without claiming it is good or bad", () => {
  const snapshot = buildStoreAnalyticsSnapshot(RANGE);
  const awaiting = snapshot.kpis.find(
    (item) => item.key === "ordersAwaitingDispatch",
  );

  assert.equal(awaiting?.favorableDirection, "neutral");
});

test("recent orders sit in the warehouse while older ones have shipped", () => {
  const asOf = "2026-08-14";
  const recent = buildStoreOrders({ start: asOf, end: asOf }, 1, asOf);
  const settled = buildStoreOrders(
    { start: "2026-07-01", end: "2026-07-07" },
    1,
    asOf,
  );

  const awaitingShare = (rows: StoreOrder[]) =>
    rows.filter((order) => isAwaitingDispatch(order.state)).length / rows.length;

  // Mirrors the live store skew: same-day orders have had no time to reach
  // dispatched, while a window six weeks back is essentially fully shipped.
  assert.equal(awaitingShare(recent) > 0.5, true);
  assert.equal(awaitingShare(settled) < 0.15, true);
});

test("resolveOrderState never returns a state Store does not store", () => {
  const valid = new Set<string>([...AWAITING_DISPATCH_STATES, "dispatched", "cancelled"]);

  for (let step = 0; step < 1000; step += 1) {
    const roll = step / 1000;
    for (const age of [0, 1, 2, 3, 10]) {
      const state = resolveOrderState(roll, age);
      assert.equal(valid.has(state), true, `${state} at roll ${roll}`);
      // `refunded` is not a member of the real enum; a return is a separate
      // entity in the store, so it must never appear as an order state.
      assert.notEqual(state, "refunded");
    }
  }
});

test("share rows are sorted and capped so a panel stays readable", () => {
  const snapshot = buildStoreAnalyticsSnapshot(RANGE);
  const rows = snapshot.sessionsByLocation;

  assert.equal(rows.length <= 8, true);
  for (let index = 1; index < rows.length; index += 1) {
    assert.equal((rows[index]?.value ?? 0) <= (rows[index - 1]?.value ?? 0), true);
  }
});

test("the catalogue breakdown nests department, sub-department, family, and product", () => {
  const snapshot = buildStoreAnalyticsSnapshot(RANGE);
  const { department, subDepartment, family, product } = snapshot.catalogue;

  assert.equal(product.every((row) => Boolean(row.sku)), true);

  // Every level is sorted by value, richest first, so a Top 15 slice never
  // has to re-sort.
  for (const level of [department, subDepartment, family, product]) {
    for (let index = 1; index < level.length; index += 1) {
      assert.equal(
        (level[index]?.value ?? 0) <= (level[index - 1]?.value ?? 0),
        true,
      );
    }
  }

  assert.equal(department.every((row) => row.parentKey === null), true);

  const departmentKeys = new Set(department.map((row) => row.key));
  const subDepartmentKeys = new Set(subDepartment.map((row) => row.key));
  const familyKeys = new Set(family.map((row) => row.key));

  // A child's declared parent always resolves to a real row one layer up,
  // so a reader can drill from department to product without a dead end.
  assert.equal(
    subDepartment.every(
      (row) => row.parentKey !== null && departmentKeys.has(row.parentKey),
    ),
    true,
  );
  assert.equal(
    family.every(
      (row) => row.parentKey !== null && subDepartmentKeys.has(row.parentKey),
    ),
    true,
  );
  assert.equal(
    product.every(
      (row) => row.parentKey !== null && familyKeys.has(row.parentKey),
    ),
    true,
  );

  // Orders are whole counts, and a node with sales has at least one order.
  for (const level of [department, subDepartment, family, product]) {
    assert.equal(
      level.every((row) => Number.isInteger(row.orders) && row.orders > 0),
      true,
    );
  }

  // Every product row carries a slug ready for a future per-node page.
  assert.equal(
    product.every((row) => row.slug.length > 0 && !row.slug.includes(" ")),
    true,
  );
  assert.equal(
    department.every((row) => row.path.startsWith("/department/")),
    true,
  );
  assert.equal(
    subDepartment.every((row) => row.path.includes("/sub-department/")),
    true,
  );
  assert.equal(family.every((row) => row.path.includes("/family/")), true);
  assert.equal(product.every((row) => row.path.includes("/product/")), true);
});

test("only family and product are limited to a sales-ranked Top 15", () => {
  const nodes = Array.from({ length: 24 }, (_, index) => ({
    key: `node-${index}`,
    slug: `item-${index}`,
    path: `/department/demo/family/item-${index}`,
    label: `Item ${index}`,
    level: "family" as const,
    parentKey: "parent",
    orders: index + 10,
    previousOrders: index + 5,
    value: index + 1,
    previousValue: index,
    share: (index + 1) / 300,
  }));

  const departments = catalogueRowsForDisplay(nodes, "department");
  const subDepartments = catalogueRowsForDisplay(nodes, "subDepartment");
  const families = catalogueRowsForDisplay(nodes, "family");
  const products = catalogueRowsForDisplay(nodes, "product");

  assert.equal(CATALOGUE_TOP_COUNT, 15);
  assert.equal(departments.length, 24);
  assert.equal(subDepartments.length, 24);
  assert.equal(families.length, 15);
  assert.equal(products.length, 15);
  assert.deepEqual(
    families.map((row) => row.value),
    Array.from({ length: 15 }, (_, index) => 24 - index),
  );
  assert.equal(families[0]?.orders, 33);
  assert.equal(families[0]?.previousValue, 23);
  assert.equal(families.at(-1)?.value, 10);
});

test("the catalogue stack keeps January to December and marks future current-year months unavailable", () => {
  const snapshot = buildStoreAnalyticsSnapshot(RANGE);
  const departments = snapshot.catalogue.department;
  const referenceDate = "2026-08-13";
  const stack = buildCatalogueStack(departments, "department", null, referenceDate);

  assert.deepEqual(
    stack.years.map((year) => year.year),
    [2024, 2025, 2026],
  );

  const [twoYearsAgo, previousYear, currentYear] = stack.years;

  assert.equal(twoYearsAgo?.months.length, 12);
  assert.equal(previousYear?.months.length, 12);
  assert.equal(
    twoYearsAgo?.months.every((month) => !month.isPartial && !month.isFuture),
    true,
  );
  assert.equal(
    previousYear?.months.every((month) => !month.isPartial && !month.isFuture),
    true,
  );

  // Reference date is 13 August: the axis still reaches December, but only
  // August is partial and September–December are unavailable rather than zero.
  assert.equal(currentYear?.months.length, 12);
  const august = currentYear?.months[7];
  assert.equal(august?.month, "2026-08");
  assert.equal(august?.isPartial, true);
  assert.equal(august?.isFuture, false);
  assert.equal(august?.throughDay, 13);
  assert.equal(
    currentYear?.months.slice(0, 7).every((month) => !month.isPartial && !month.isFuture),
    true,
  );
  const futureMonths = currentYear?.months.slice(8) ?? [];
  assert.deepEqual(
    futureMonths.map((month) => month.month),
    ["2026-09", "2026-10", "2026-11", "2026-12"],
  );
  assert.equal(
    futureMonths.every(
      (month) =>
        month.isFuture &&
        !month.isPartial &&
        month.throughDay === null &&
        Object.keys(month.values).length === 0 &&
        month.other === 0,
    ),
    true,
  );
});

test("the stacked chart tooltip identifies one department and its monthly stats", () => {
  const tooltip = buildStackedSegmentTooltip({
    month: {
      month: "2026-08",
      label: "August",
      isFuture: false,
      isPartial: true,
      throughDay: 13,
      values: { home: 600, beauty: 300, gifts: 100 },
      other: 0,
    },
    monthIndex: 7,
    monthCount: 12,
    year: 2026,
    segmentKey: "beauty",
    segments: [
      { key: "home", label: "Home" },
      { key: "beauty", label: "Beauty" },
      { key: "gifts", label: "Gifts" },
    ],
    otherLabel: "Other",
    formatValue: (value) => `£${value.toFixed(2)}`,
  });

  assert.equal(tooltip?.title, "Beauty · August 2026 · 1–13");
  assert.deepEqual(tooltip?.rows, [
    {
      label: "Sales",
      value: "£300.00",
      swatch: "legend-dot--catalogue-1",
    },
    { label: "Share of month", value: "30.0%" },
    { label: "Month total", value: "£1000.00", muted: true },
  ]);
});

test("the stacked chart aligns the full calendar axis with its bar clusters", () => {
  const snapshot = buildStoreAnalyticsSnapshot(RANGE);
  const departments = snapshot.catalogue.department;
  const stack = buildCatalogueStack(
    departments,
    "department",
    null,
    "2026-08-13",
  );
  const markup = renderToStaticMarkup(
    createElement(StackedBarChart, {
      ariaLabel: "Department sales",
      years: stack.years,
      segments: stack.nodes,
      otherLabel: "Other",
      formatValue: (value: number) => `£${value.toFixed(2)}`,
    }),
  );

  const januaryCentre = getStackedMonthCentre(0, 12);
  const decemberCentre = getStackedMonthCentre(11, 12);

  assert.match(markup, new RegExp(`x="${januaryCentre}" y="250">Jan<\\/text>`));
  assert.match(markup, new RegExp(`x="${decemberCentre}" y="250">Dec<\\/text>`));
  assert.equal(januaryCentre, 52 + (960 - 52 - 16) / 12 / 2);
  assert.equal(decemberCentre, 52 + ((960 - 52 - 16) / 12) * 11.5);
  assert.match(markup, /Sep.*Dec are future months, not zero sales/);
  assert.doesNotMatch(markup, /September 2026, sales/);
  assert.doesNotMatch(markup, /December 2026, sales/);
});

test("the broad month hit target renders behind the interactive stack segments", () => {
  const markup = renderToStaticMarkup(
    createElement(StackedBarChart, {
      ariaLabel: "Department sales",
      years: [
        {
          year: 2026,
          months: [
            {
              month: "2026-08",
              label: "August",
              isFuture: false,
              isPartial: false,
              throughDay: null,
              values: { home: 600, beauty: 300, gifts: 100 },
              other: 0,
            },
          ],
        },
      ],
      segments: [
        { key: "home", label: "Home" },
        { key: "beauty", label: "Beauty" },
        { key: "gifts", label: "Gifts" },
      ],
      otherLabel: "Other",
      formatValue: (value: number) => `£${value.toFixed(2)}`,
    }),
  );

  const monthHitIndex = markup.indexOf('class="chart-hit"');
  const segmentIndex = markup.indexOf('class="stacked-bar-chart__segment');

  assert.equal(monthHitIndex >= 0, true);
  assert.equal(segmentIndex > monthHitIndex, true);
  assert.match(markup, /Home, August 2026, sales £600\.00, 60\.0% of month/);
  assert.match(markup, /tabindex="0"[^>]*role="button"|role="button"[^>]*tabindex="0"/);
});

test("the catalogue stack tracks only the given nodes, everything else falls to other", () => {
  const snapshot = buildStoreAnalyticsSnapshot(RANGE);
  const departments = snapshot.catalogue.department;
  const top = departments.slice(0, 1);
  const stack = buildCatalogueStack(top, "subDepartment", departments[0]?.key ?? "", "2026-08-13");

  assert.equal(stack.hasOther, true);
  const trackedKeys = new Set(stack.nodes.map((node) => node.key));

  for (const year of stack.years) {
    for (const month of year.months) {
      assert.equal(
        Object.keys(month.values).every((key) => trackedKeys.has(key)),
        true,
      );
      assert.equal(
        Object.values(month.values).every((value) => value >= 0),
        true,
      );
      assert.equal(month.other >= 0, true);
    }
  }
});

test("department never carries an other bucket, even from an incomplete node list", () => {
  const snapshot = buildStoreAnalyticsSnapshot(RANGE);
  const departments = snapshot.catalogue.department;
  // Deliberately incomplete: real sales exist outside this one-row set.
  const incomplete = departments.slice(0, 1);
  const stack = buildCatalogueStack(incomplete, "department", null, "2026-08-13");

  assert.equal(stack.hasOther, false);
  for (const year of stack.years) {
    assert.equal(
      year.months.every((month) => month.other === 0),
      true,
    );
  }
});

test("cohort retention starts at 100% and decays without going negative", () => {
  const snapshot = buildStoreAnalyticsSnapshot(RANGE);

  for (const cohort of snapshot.cohorts) {
    assert.equal(cohort.retention[0], 1);
    assert.equal(
      cohort.retention.every((value) => value >= 0 && value <= 1),
      true,
    );
  }
  assert.equal(snapshot.cohorts[0]?.retention.length, 8);
  assert.equal(snapshot.cohorts.at(-1)?.retention.length, 1);
});

test("RFM analysis preserves stable labels and reconciles every segment", () => {
  const snapshot = buildStoreAnalyticsSnapshot(RANGE);
  const rfm = snapshot.rfm;
  const segmentCustomers = rfm.segments.reduce(
    (total, segment) => total + segment.customerCount,
    0,
  );
  const segmentOrders = rfm.segments.reduce(
    (total, segment) => total + segment.totalOrders,
    0,
  );
  const segmentSpent = rfm.segments.reduce(
    (total, segment) => total + segment.totalSpent,
    0,
  );

  assert.equal(rfm.lookbackRange.end, RANGE.end);
  assert.equal(rfm.fieldLabels.customerCount, "Customer records");
  assert.equal(rfm.fieldLabels.segment, "RFM segment");
  assert.equal(segmentCustomers, rfm.summary.customerCount);
  assert.equal(segmentOrders, rfm.summary.totalOrders);
  assert.equal(Math.abs(segmentSpent - rfm.summary.totalSpent) < 0.1, true);
  assert.equal(
    Math.abs(
      rfm.segments.reduce(
        (total, segment) => total + segment.customerShare,
        0,
      ) - 1,
    ) < 0.000_1,
    true,
  );

  // Customer deep dive roster assertions
  assert.equal(rfm.customers.length, rfm.summary.customerCount);
  assert.equal(
    rfm.customers.every(
      (c) =>
        c.customerId.length > 0 &&
        c.name.length > 0 &&
        c.firstName.length > 0 &&
        c.lastName.length > 0 &&
        c.email.includes("@") &&
        /^\+[1-9]\d{7,14}$/.test(c.phone) &&
        c.zip.length > 0 &&
        c.country === "ID" &&
        c.company.length > 0 &&
        c.recencyScore >= 1 &&
        c.recencyScore <= 5 &&
        c.frequencyScore >= 1 &&
        c.frequencyScore <= 5 &&
        c.monetaryScore >= 1 &&
        c.monetaryScore <= 5 &&
        c.frequency >= 1 &&
        c.monetary > 0 &&
        c.aov > 0 &&
        c.topCategory.length > 0 &&
        c.statusTag.length > 0 &&
        c.lastOrderDate.length > 0,
    ),
    true,
  );
});

test("RFM customer match fields follow each store market deterministically", () => {
  const expectedMarkets = new Map([
    ["Asia/Jakarta", { country: "ID", phone: /^\+62/, zip: /^\d{5}$/ }],
    ["Asia/Makassar", { country: "ID", phone: /^\+62/, zip: /^\d{5}$/ }],
  ]);

  for (const account of ACCOUNT_OPTIONS) {
    const snapshot = buildStoreAnalyticsSnapshot(RANGE, {
      store: storeForAccount(account),
      scale: account.fixtureScale,
    });
    const repeated = buildStoreAnalyticsSnapshot(RANGE, {
      store: storeForAccount(account),
      scale: account.fixtureScale,
    });
    const customer = snapshot.rfm.customers[0];
    const expected = expectedMarkets.get(account.timezone);

    assert.notEqual(customer, undefined);
    assert.notEqual(expected, undefined);
    assert.equal(customer?.country, expected?.country);
    assert.match(customer?.phone ?? "", expected?.phone ?? /^$/);
    assert.match(customer?.zip ?? "", expected?.zip ?? /^$/);
    assert.deepEqual(customer, repeated.rfm.customers[0]);
  }
});

test("unit economics compares trailing customer value with supplied blended CAC", () => {
  const snapshot = buildStoreAnalyticsSnapshot(RANGE, {
    estimatedBlendedCac: 25,
  });
  const economics = snapshot.unitEconomics;

  assert.equal(economics.averageCustomerLifetimeValue > 0, true);
  assert.equal(economics.estimatedBlendedCac, 25);
  assert.equal(
    economics.ltvToCacRatio,
    Math.round((economics.averageCustomerLifetimeValue / 25) * 100) / 100,
  );
});

test("the store snapshot defaults to the previous period like for like", () => {
  const snapshot = buildStoreAnalyticsSnapshot(RANGE);

  assert.equal(snapshot.comparisonEnabled, true);
  assert.equal(snapshot.comparisonBasis.label, "Previous period");
  assert.equal(snapshot.comparisonBasis.activeDays, 14);
  assert.equal(snapshot.comparisonBasis.comparisonDays, 14);
  assert.equal(snapshot.comparisonBasis.normalisedToActiveDuration, false);
  assert.equal(snapshot.comparisonBasis.alignedByDay, true);
});

test("the chosen comparison window moves the baseline every panel reads", () => {
  const snapshot = buildStoreAnalyticsSnapshot(RANGE, {
    comparisonWindow: "previous-year",
  });

  assert.deepEqual(snapshot.comparisonRange, {
    start: "2025-07-01",
    end: "2025-07-14",
  });
  assert.equal(snapshot.comparisonBasis.label, "Same period last year");
  // A same-length baseline still pairs day by day, so the line is drawn.
  assert.equal(snapshot.comparisonBasis.alignedByDay, true);
  assert.equal(
    snapshot.salesOverTime.points.every(
      (point) => point.comparisonValue !== null,
    ),
    true,
  );
});

test("a custom baseline is used verbatim rather than recomputed", () => {
  const snapshot = buildStoreAnalyticsSnapshot(RANGE, {
    comparisonWindow: "custom",
    comparisonRange: { start: "2026-05-01", end: "2026-05-10" },
  });

  assert.deepEqual(snapshot.comparisonRange, {
    start: "2026-05-01",
    end: "2026-05-10",
  });
  assert.equal(snapshot.comparisonBasis.comparisonDays, 10);
  assert.equal(snapshot.comparisonBasis.normalisedToActiveDuration, true);
});

test("a longer baseline is scaled to the active duration, not shown raw", () => {
  const long = buildStoreAnalyticsSnapshot(RANGE, { comparisonWindow: "90d" });
  const raw = buildStoreAnalyticsSnapshot(
    { start: long.comparisonRange.start, end: long.comparisonRange.end },
    { comparisonEnabled: false },
  );
  const factor = 14 / 90;

  assert.equal(long.comparisonBasis.comparisonDays, 90);
  assert.equal(long.comparisonBasis.normalisedToActiveDuration, true);

  const baseline = long.kpis.find((item) => item.key === "totalSales")
    ?.previousValue;
  const rawTotal = raw.kpis.find((item) => item.key === "totalSales")?.value;

  assert.notEqual(baseline, null);
  assert.notEqual(rawTotal, null);
  assert.equal(Math.abs((baseline ?? 0) - (rawTotal ?? 0) * factor) < 0.05, true);
});

test("an unequal baseline withholds the day-by-day line instead of guessing", () => {
  const snapshot = buildStoreAnalyticsSnapshot(RANGE, {
    comparisonWindow: "90d",
  });

  assert.equal(snapshot.comparisonBasis.alignedByDay, false);
  assert.equal(
    snapshot.salesOverTime.points.every(
      (point) => point.comparisonValue === null,
    ),
    true,
  );
  // The scaled total still reports, so the period is not left uncompared.
  assert.notEqual(snapshot.salesOverTime.previousTotal, null);
});

test("a ratio baseline is never scaled the way an additive one is", () => {
  const long = buildStoreAnalyticsSnapshot(RANGE, { comparisonWindow: "90d" });
  const raw = buildStoreAnalyticsSnapshot(
    { start: long.comparisonRange.start, end: long.comparisonRange.end },
    { comparisonEnabled: false },
  );

  const baselineRate = long.kpis.find(
    (item) => item.key === "conversionRate",
  )?.previousValue;
  const rawRate = raw.kpis.find((item) => item.key === "conversionRate")?.value;

  assert.notEqual(baselineRate, null);
  assert.equal(baselineRate, rawRate);
});

test("switching comparison off withholds every delta instead of showing zero", () => {
  const snapshot = buildStoreAnalyticsSnapshot(RANGE, {
    comparisonEnabled: false,
  });

  assert.equal(snapshot.comparisonEnabled, false);
  assert.equal(snapshot.comparisonBasis.label, "No comparison");
  // The window still resolves so the UI can name what it is withholding.
  assert.deepEqual(snapshot.comparisonRange, {
    start: "2026-06-17",
    end: "2026-06-30",
  });

  assert.equal(
    snapshot.kpis.every((item) => item.previousValue === null),
    true,
  );
  assert.equal(
    snapshot.salesBreakdown.every((row) => row.previousValue === null),
    true,
  );
  assert.equal(
    snapshot.catalogue.product.every((row) => row.previousValue === null),
    true,
  );
  assert.equal(
    snapshot.conversionFunnel.every((step) => step.previousSessions === null),
    true,
  );
  assert.equal(
    snapshot.salesOverTime.points.every(
      (point) => point.comparisonValue === null,
    ),
    true,
  );
  assert.equal(snapshot.salesOverTime.previousTotal, null);

  // The active period is untouched by the comparison switch.
  assert.equal(
    snapshot.kpis.every((item) => item.value !== null),
    true,
  );
  assert.equal(snapshot.catalogue.product.length > 0, true);
});

test("the active period and its own figures survive a baseline change", () => {
  const previous = buildStoreAnalyticsSnapshot(RANGE);
  const lastYear = buildStoreAnalyticsSnapshot(RANGE, {
    comparisonWindow: "previous-year",
  });
  const off = buildStoreAnalyticsSnapshot(RANGE, { comparisonEnabled: false });

  const totalSalesOfSnapshot = (snapshot: typeof previous) =>
    snapshot.kpis.find((item) => item.key === "totalSales")?.value;

  assert.equal(totalSalesOfSnapshot(previous), totalSalesOfSnapshot(lastYear));
  assert.equal(totalSalesOfSnapshot(previous), totalSalesOfSnapshot(off));
  assert.deepEqual(
    previous.salesOverTime.points.map((point) => point.value),
    off.salesOverTime.points.map((point) => point.value),
  );
  assert.deepEqual(previous.yearlyPerformance, off.yearlyPerformance);
  assert.deepEqual(previous.cohorts, off.cohorts);
});
