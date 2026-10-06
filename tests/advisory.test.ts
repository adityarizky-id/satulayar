import assert from "node:assert/strict";
import test from "node:test";

import { buildRuleBasedAdvisory } from "../src/lib/dashboard/advisory";
import { buildBudgetPacing } from "../src/lib/dashboard/budget";
import { buildDashboardSnapshot } from "../src/lib/dashboard/fixtures";
import { aggregateMetrics } from "../src/lib/dashboard/kpi";
import { evaluateAcquisitionGuardrail } from "../src/lib/dashboard/account-contract";
import { evaluateDataQuality } from "../src/lib/dashboard/data-quality";
import { buildJourneyCards } from "../src/lib/dashboard/scorecard";
import type { DailyMetric, Platform } from "../src/lib/dashboard/types";

const RANGE = { start: "2026-07-01", end: "2026-07-14" };

function row(
  date: string,
  platform: Exclude<Platform, "all">,
  overrides: Partial<DailyMetric> = {},
): DailyMetric {
  return {
    date,
    clientId: "demo",
    accountId: "demo",
    platform,
    currency: "GBP",
    accountTimezone: "Europe/London",
    spend: 100,
    impressions: 10_000,
    clicks: 200,
    landingPageViews: 160,
    registrations: 20,
    purchases: 5,
    platformConversionValue: 400,
    actualPurchaseRevenue: 300,
    sourceConnector: "mock",
    sourceQueryVersion: "fixture-v1",
    syncedAt: "2026-07-15T00:00:00.000Z",
    isProvisional: false,
    ...overrides,
  };
}

function briefFor(rows: DailyMetric[], budgets: { meta: number; google: number }) {
  const totals = aggregateMetrics(rows);
  const cards = buildJourneyCards(totals, totals, "fixture-v1", "all");
  const guardrail = evaluateAcquisitionGuardrail(totals, {
    currency: "GBP",
    costAggregationAllowed: true,
  });

  return buildRuleBasedAdvisory({
    cards,
    guardrail,
    pacing: buildBudgetPacing(rows, RANGE, budgets, "GBP"),
    impressionShare: null,
    quality: evaluateDataQuality(rows, RANGE, "all", { mode: "mock" }),
    currency: "GBP",
    platform: "all",
  });
}

test("a rule-based brief never claims to be model output", () => {
  const brief = briefFor([row("2026-07-01", "meta")], {
    meta: 1_500,
    google: 1_500,
  });

  assert.equal(brief.source, "rule-based");
  assert.equal(brief.generatedAt, null);
  assert.equal(brief.model, null);
  assert.equal(brief.status, "draft");
  assert.match(brief.provenanceNote, /not by a model/);
});

test("overspending raises an action that names the daily figure to hold", () => {
  const rows = Array.from({ length: 14 }, (_, index) =>
    row(`2026-07-${String(index + 1).padStart(2, "0")}`, "meta", { spend: 60 }),
  );
  // 14 days at 60 is 840 against a 500 budget, with the month only 45% through.
  const brief = briefFor(rows, { meta: 500, google: 5_000 });
  const pacingObservation = brief.observations.find(
    (item) => item.id === "pacing-meta",
  );
  const pacingAction = brief.actions.find(
    (item) => item.id === "pacing-meta-action",
  );

  assert.equal(pacingObservation?.severity, "act");
  assert.equal(pacingObservation?.evidence, "Budget pacing");
  assert.equal(pacingAction?.expectedMetric, "spend");
  assert.equal(pacingAction?.expectedDirection, "down");
});

test("ahead of pace inside the budget is a watch, never a red act", () => {
  // 840 spent against 1,000 is 84% of the budget on day 20 of 30 (67% even
  // pace): ahead of plan, but still inside the budget, so red would overstate it.
  const rows = Array.from({ length: 14 }, (_, index) =>
    row(`2026-07-${String(index + 1).padStart(2, "0")}`, "meta", { spend: 60 }),
  );
  const brief = briefFor(rows, { meta: 1_000, google: 5_000 });
  const pacing = buildBudgetPacing(rows, RANGE, { meta: 1_000, google: 5_000 }, "GBP");
  const meta = pacing.platforms.find((item) => item.platform === "meta");
  const pacingObservation = brief.observations.find(
    (item) => item.id === "pacing-meta",
  );

  assert.equal(meta?.status, "overspending");
  assert.ok((meta?.actualProgress ?? 1) < 1);
  assert.equal(pacingObservation?.severity, "watch");
  // No stored agreement was passed in, so nothing may call the plan "agreed".
  assert.doesNotMatch(String(pacingObservation?.headline), /agreed/);
});

test("every observation names a section the reader can open to check it", () => {
  const snapshot = buildDashboardSnapshot(RANGE, "all");
  const sections = new Set([
    "Account snapshot",
    "Budget pacing",
    "Customer journey metrics",
    "Impression share",
    "Data health",
  ]);

  assert.ok(snapshot.advisory.observations.length > 0);
  for (const observation of snapshot.advisory.observations) {
    assert.equal(sections.has(observation.evidence), true);
  }
});

test("a clean period says so instead of inventing something to worry about", () => {
  const clean = { spend: 10, purchases: 40, registrations: 120, clicks: 400 };
  // Both platforms present, or the data-quality gate reports half a period.
  const rows = Array.from({ length: 14 }, (_, index) => [
    row(`2026-07-${String(index + 1).padStart(2, "0")}`, "meta", clean),
    row(`2026-07-${String(index + 1).padStart(2, "0")}`, "google", clean),
  ]).flat();
  // 140 spent per platform, 20 days into the 25 Jun - 24 Jul cycle the filter
  // closes in. Two thirds of a 210 cycle budget spent two thirds of the way
  // through the cycle is exactly on plan, so there is nothing to raise.
  const brief = briefFor(rows, { meta: 210, google: 210 });
  const pacing = brief.observations.filter((item) =>
    item.id.startsWith("pacing-"),
  );

  assert.equal(pacing.length, 0);
  assert.equal(
    brief.observations.every((item) => item.severity !== "act"),
    true,
  );
});
