import assert from "node:assert/strict";
import test from "node:test";

import { aggregateMetrics } from "../src/lib/dashboard/kpi";
import { buildJourneyCards } from "../src/lib/dashboard/scorecard";
import type { DailyMetric, MetricCardData } from "../src/lib/dashboard/types";

/**
 * Landing page views are the first metric in the dashboard whose availability
 * depends on how an individual ad account is configured rather than on which
 * platform it belongs to. Meta derives them from its pixel everywhere; a
 * Google account only reports them once a page-view conversion action is
 * mapped and firing, and most accounts have none yet.
 *
 * The contract these tests lock down is that "nobody measured this" survives
 * every hop as null and never degrades into 0. A zero is a finding — it claims
 * nobody reached the site — and for an account that is plainly taking orders
 * that finding is false rather than merely missing.
 */

const metaRow: DailyMetric = {
  date: "2026-09-01",
  clientId: "kopi-senja",
  accountId: "meta-1",
  platform: "meta",
  currency: "GBP",
  accountTimezone: "Europe/London",
  spend: 100,
  impressions: 1_000,
  clicks: 100,
  landingPageViews: 80,
  registrations: 10,
  purchases: 4,
  platformConversionValue: 300,
  actualPurchaseRevenue: 240,
  sourceConnector: "mock",
  sourceQueryVersion: "fixture-v1",
  syncedAt: "2026-09-19T00:00:00.000Z",
  isProvisional: false,
};

/** A Google account with no page-view conversion action mapped. */
const googleRow: DailyMetric = {
  ...metaRow,
  accountId: "google-1",
  platform: "google",
  landingPageViews: null,
};

function cardFor(cards: MetricCardData[], key: string): MetricCardData {
  const card = cards.find((item) => item.key === key);
  assert.ok(card, `expected a ${key} card`);
  return card;
}

test("an unmapped account reports landing page views as not measured, not as zero", () => {
  const totals = aggregateMetrics([googleRow, { ...googleRow, date: "2026-09-02" }]);

  assert.equal(totals.landingPageViews, null);
  // The clicks are real and must survive: only the unmeasured metric is null.
  assert.equal(totals.clicks, 200);
});

test("every ratio built on an unmeasured metric is unmeasured too", () => {
  const totals = aggregateMetrics([googleRow]);

  // The regression this guards: with landingPageViews stored as 0, each of
  // these read as a real figure — 0.0% click-to-landing on an account that
  // took four orders that day — which is a false finding, not a missing one.
  assert.equal(totals.clickToLpvRate, null);
  assert.equal(totals.costPerLandingPageView, null);
  assert.equal(totals.lpvToRegistrationRate, null);
});

test("a measured account still reports the ratios", () => {
  const totals = aggregateMetrics([metaRow]);

  assert.equal(totals.landingPageViews, 80);
  assert.equal(totals.clickToLpvRate, 0.8);
  assert.equal(totals.costPerLandingPageView, 1.25);
});

test("mixing a measured and an unmeasured source sums only what was measured", () => {
  const totals = aggregateMetrics([metaRow, googleRow]);

  // 80, not 80 + 0. Adding the unmeasured side as zero would understate the
  // rate against the combined click count and invent a drop-off that the data
  // does not show.
  assert.equal(totals.landingPageViews, 80);
  assert.equal(totals.clicks, 200);
  assert.equal(totals.clickToLpvRate, 0.4);
});

test("a zero that was genuinely measured stays a zero", () => {
  const totals = aggregateMetrics([{ ...metaRow, landingPageViews: 0 }]);

  // Null is reserved for "not measured". A pixel that fired and counted
  // nothing is a real finding and must not be hidden behind the same state.
  assert.equal(totals.landingPageViews, 0);
  assert.equal(totals.clickToLpvRate, 0);
});

test("cards mark an unmeasured metric and its ratios as not reported", () => {
  const totals = aggregateMetrics([googleRow]);
  const cards = buildJourneyCards(totals, totals, "test-v1", "google");

  for (const key of [
    "landingPageViews",
    "clickToLpvRate",
    "costPerLandingPageView",
  ]) {
    assert.equal(
      cardFor(cards, key).availability,
      "not-reported",
      `${key} should be flagged as not reported`,
    );
  }
});

test("cards mark a measured metric as reported", () => {
  const totals = aggregateMetrics([metaRow]);
  const cards = buildJourneyCards(totals, totals, "test-v1", "meta");

  assert.equal(cardFor(cards, "landingPageViews").availability, "reported");
  assert.equal(cardFor(cards, "clickToLpvRate").availability, "reported");
});

test("a null that only means an empty denominator is still reported", () => {
  const totals = aggregateMetrics([
    { ...metaRow, spend: 0, clicks: 0, impressions: 0 },
  ]);
  const card = cardFor(
    buildJourneyCards(totals, totals, "test-v1", "meta"),
    "cpc",
  );

  // CPC is null here because there were no clicks to divide by, which is a
  // different statement from "CPC was never tracked". The card must not claim
  // the metric is missing when only its denominator is.
  assert.equal(card.value, null);
  assert.equal(card.availability, "reported");
});

test("each consideration signal carries its own availability", () => {
  // A common shape: a basket action mapped, no page-view action.
  const totals = aggregateMetrics([
    { ...googleRow, addToBaskets: 12, engagedVisits: null },
  ]);
  const cards = buildJourneyCards(totals, totals, "test-v1", "google");

  assert.equal(cardFor(cards, "landingPageViews").availability, "not-reported");
  assert.equal(cardFor(cards, "engagedVisits").availability, "not-reported");
  assert.equal(cardFor(cards, "addToBaskets").availability, "reported");
  assert.equal(cardFor(cards, "addToBaskets").value, 12);
  assert.equal(cardFor(cards, "costPerAddToBasket").value, 100 / 12);
});

test("a ratio needs both of its sides measured", () => {
  // Page views missing, baskets present: the step between them is unknowable
  // even though one end of it was counted.
  const totals = aggregateMetrics([{ ...googleRow, addToBaskets: 12 }]);
  const cards = buildJourneyCards(totals, totals, "test-v1", "google");

  assert.equal(totals.lpvToBasketRate, null);
  assert.equal(cardFor(cards, "lpvToBasketRate").availability, "not-reported");
});

test("both sides measured produces the basket ratio", () => {
  const totals = aggregateMetrics([
    { ...metaRow, landingPageViews: 80, addToBaskets: 20 },
  ]);

  assert.equal(totals.lpvToBasketRate, 0.25);
});

test("Meta reports baskets but never a dwell signal", () => {
  const totals = aggregateMetrics([{ ...metaRow, addToBaskets: 20 }]);
  const cards = buildJourneyCards(totals, totals, "test-v1", "meta");

  // Meta has add_to_cart on the pixel but nothing equivalent to Google's
  // time-on-site action, so the two must not share one availability state.
  assert.equal(cardFor(cards, "addToBaskets").availability, "reported");
  assert.equal(cardFor(cards, "engagedVisits").availability, "not-reported");
});

test("availability is read from the selected period, not the comparison one", () => {
  const measured = aggregateMetrics([metaRow]);
  const unmeasured = aggregateMetrics([googleRow]);
  const cards = buildJourneyCards(unmeasured, measured, "test-v1", "all");

  // Tracking that broke this period is exactly what the card has to show, so
  // a healthy comparison period must not mask the current one.
  assert.equal(cardFor(cards, "landingPageViews").availability, "not-reported");
});
