import assert from "node:assert/strict";
import test from "node:test";

import {
  ATTRIBUTION_GAP_THRESHOLD_PERCENT,
  COST_SPIKE_THRESHOLD_PERCENT,
  evaluatePerformanceAnomalies,
  SPEND_DROP_THRESHOLD_PERCENT,
} from "@/lib/dashboard/anomaly-engine";
import { buildCommandIndex, searchCommandIndex } from "@/lib/dashboard/command-index";
import { buildExecutiveSummary } from "@/lib/dashboard/executive-summary-exporter";
import { buildDashboardSnapshot } from "@/lib/dashboard/fixtures";
import type { DashboardSnapshot } from "@/lib/dashboard/types";

/** Fixture snapshot, then shaped per test. Nothing here touches a connector. */
function snapshot(overrides: Partial<DashboardSnapshot> = {}): DashboardSnapshot {
  return { ...buildDashboardSnapshot(), ...overrides };
}

function withTotals(
  base: DashboardSnapshot,
  totals: Partial<DashboardSnapshot["totals"]>,
  comparison: Partial<DashboardSnapshot["comparisonTotals"]>,
): DashboardSnapshot {
  return {
    ...base,
    totals: { ...base.totals, ...totals },
    comparisonTotals: { ...base.comparisonTotals, ...comparison },
  };
}

/** A snapshot the engine is willing to judge: closed, cleared, comparable. */
function comparableSnapshot(): DashboardSnapshot {
  const base = snapshot();
  return {
    ...base,
    dataStatus: "ready",
    comparisonEnabled: true,
    quality: { ...base.quality, provisionalDates: [], summaryBlocked: false },
  };
}

// ------------------------------------------------------------ anomaly engine

test("a blocked period suppresses every check instead of raising alarms", () => {
  const report = evaluatePerformanceAnomalies({
    ...comparableSnapshot(),
    dataStatus: "blocked",
  });

  assert.equal(report.suppressed, true);
  assert.deepEqual(report.anomalies, []);
  assert.equal(
    report.suppressionReasons.some((reason) => /data-quality gate/.test(reason)),
    true,
  );
});

test("an open day suppresses the checks, because the periods are not comparable", () => {
  const base = comparableSnapshot();
  const report = evaluatePerformanceAnomalies({
    ...base,
    quality: { ...base.quality, provisionalDates: ["2026-07-14"] },
  });

  assert.equal(report.suppressed, true);
  assert.equal(
    report.suppressionReasons.some((reason) => /still open/.test(reason)),
    true,
  );
});

test("with comparison switched off there is no baseline, so nothing is claimed", () => {
  const report = evaluatePerformanceAnomalies({
    ...comparableSnapshot(),
    comparisonEnabled: false,
  });

  assert.equal(report.suppressed, true);
  assert.equal(report.anomalies.length, 0);
});

test("a cost per order spike above the threshold is flagged with its size", () => {
  const report = evaluatePerformanceAnomalies(
    withTotals(
      comparableSnapshot(),
      { costPerPurchase: 40, purchases: 20 },
      { costPerPurchase: 25, purchases: 20 },
    ),
  );
  const anomaly = report.anomalies.find((item) => item.code === "cost-per-order-spike");

  assert.equal(report.suppressed, false);
  assert.ok(anomaly);
  assert.equal(Math.round(anomaly.changePercent ?? 0), 60);
  assert.equal(anomaly.severity, "critical");
  // The engine reports movement and what to check; it never claims a cause.
  assert.doesNotMatch(anomaly.message, /because|caused/i);
});

test("a cost spike on tiny volume is arithmetic, not a signal", () => {
  const report = evaluatePerformanceAnomalies(
    withTotals(
      comparableSnapshot(),
      { costPerPurchase: 60, purchases: 2 },
      { costPerPurchase: 25, purchases: 3 },
    ),
  );

  assert.equal(
    report.anomalies.some((item) => item.code === "cost-per-order-spike"),
    false,
  );
});

test("a cost per order just under the threshold stays quiet", () => {
  const report = evaluatePerformanceAnomalies(
    withTotals(
      comparableSnapshot(),
      { costPerPurchase: 24, purchases: 20 },
      { costPerPurchase: 20, purchases: 20 },
    ),
  );

  assert.equal(COST_SPIKE_THRESHOLD_PERCENT, 25);
  assert.equal(
    report.anomalies.some((item) => item.code === "cost-per-order-spike"),
    false,
  );
});

test("a spend collapse is flagged and points at the usual causes", () => {
  const report = evaluatePerformanceAnomalies(
    withTotals(comparableSnapshot(), { spend: 300 }, { spend: 1000 }),
  );
  const anomaly = report.anomalies.find((item) => item.code === "spend-collapse");

  assert.equal(SPEND_DROP_THRESHOLD_PERCENT, -30);
  assert.ok(anomaly);
  assert.equal(Math.round(anomaly.changePercent ?? 0), -70);
  assert.match(anomaly.suggestedCheck, /disapproved|budget|payment/i);
});

test("platforms claiming far more orders than the store dispatched is flagged", () => {
  const base = comparableSnapshot();
  // Mock snapshots keep the modelled store figures; live ones withhold them.
  assert.ok(base.blendedMer);
  const report = evaluatePerformanceAnomalies({
    ...base,
    blendedMer: {
      ...base.blendedMer,
      realStoreOrders: 40,
      claimedPlatformOrders: 70,
    },
  });
  const anomaly = report.anomalies.find((item) => item.code === "attribution-gap");

  assert.equal(ATTRIBUTION_GAP_THRESHOLD_PERCENT, 25);
  assert.ok(anomaly);
  assert.equal(Math.round(anomaly.changePercent ?? 0), 75);
  assert.match(anomaly.suggestedCheck, /dispatched/i);
});

test("the report always states the thresholds it judged against", () => {
  const report = evaluatePerformanceAnomalies(comparableSnapshot());

  assert.deepEqual(report.thresholds, {
    costPerOrderIncreasePercent: 25,
    costPerRegistrationIncreasePercent: 25,
    spendDropPercent: -30,
    attributionGapPercent: 25,
  });
});

// ------------------------------------------------------ executive summary

test("the executive summary carries the headline figures in account currency", () => {
  const result = buildExecutiveSummary(comparableSnapshot());
  const labels = result.lines.map((line) => line.label);

  assert.ok(labels.includes("Ad spend"));
  assert.ok(labels.includes("ROAS"));
  assert.ok(labels.includes("Blended MER (store sales / ad spend)"));
  assert.ok(labels.includes("Budget pacing"));
  assert.match(result.title, /paid media summary/);
  // USD account: the text must not quietly render another currency symbol.
  assert.match(result.text, /\$/);
  assert.doesNotMatch(result.text, /£|€|Rp/);
});

test("profit is withheld unless a gross margin is supplied", () => {
  const withoutMargin = buildExecutiveSummary(comparableSnapshot());
  const profitLine = withoutMargin.lines.find((line) =>
    line.label.startsWith("Gross profit"),
  );

  assert.equal(profitLine?.value, "unavailable");
  assert.match(profitLine?.note ?? "", /cost of goods/);

  const withMargin = buildExecutiveSummary(comparableSnapshot(), {
    grossMarginPercent: 60,
  });
  const estimated = withMargin.lines.find((line) => line.label.startsWith("Gross profit"));
  assert.notEqual(estimated?.value, "unavailable");
  assert.match(estimated?.note ?? "", /estimate at 60%/);
});

test("a blocked snapshot says so before any figure is circulated", () => {
  const base = comparableSnapshot();
  const result = buildExecutiveSummary({
    ...base,
    dataStatus: "blocked",
    quality: { ...base.quality, summaryBlocked: true },
  });

  assert.equal(result.blocked, true);
  assert.equal(
    result.caveats.some((caveat) => /must not be circulated as final/.test(caveat)),
    true,
  );
  assert.match(result.text, /Notes:/);
});

test("with comparison off the summary omits period-over-period notes", () => {
  const result = buildExecutiveSummary({
    ...comparableSnapshot(),
    comparisonEnabled: false,
  });

  assert.equal(
    result.lines.some((line) => /vs previous period/.test(line.note ?? "")),
    false,
  );
});

// ---------------------------------------------------------- command index

const SECTIONS = [
  { id: "impression-share", label: "Impression share" },
  { id: "audience", label: "Audience" },
  { id: "blended-mer", label: "Blended MER" },
];

test("a viewer is never offered an operational or export command", () => {
  const entries = buildCommandIndex({ role: "viewer", platform: "all", sections: SECTIONS });

  assert.equal(
    entries.some((entry) => entry.group === "Operations" || entry.group === "Exports"),
    false,
    "a permission-gated entry must be absent from the index, not hidden in the UI",
  );
  assert.ok(entries.some((entry) => entry.group === "Accounts"));
});

test("an internal editor gets refresh and exports but not access management", () => {
  const entries = buildCommandIndex({
    role: "internal_editor",
    platform: "all",
    sections: SECTIONS,
  });
  const ids = entries.map((entry) => entry.id);

  assert.ok(ids.includes("operation:refresh"));
  assert.ok(ids.includes("export:audience-meta"));
  assert.equal(ids.includes("operation:access"), false);
});

test("an admin gets everything, including access management", () => {
  const ids = buildCommandIndex({
    role: "admin",
    platform: "all",
    sections: SECTIONS,
  }).map((entry) => entry.id);

  assert.ok(ids.includes("operation:access"));
  assert.ok(ids.includes("export:cohort-analytics"));
});

test("the palette cannot scroll to a section the platform filter hides", () => {
  const googleOnly = buildCommandIndex({
    role: "admin",
    platform: "google",
    sections: SECTIONS,
  }).map((entry) => entry.id);

  assert.ok(googleOnly.includes("section:impression-share"));
  // Audience is a Meta-only panel and is not rendered under a Google filter.
  assert.equal(googleOnly.includes("section:audience"), false);
});

test("search ranks a label prefix above a keyword hit", () => {
  const entries = buildCommandIndex({ role: "admin", platform: "all", sections: SECTIONS });
  const results = searchCommandIndex(entries, "meta");

  assert.ok(results.length > 0);
  assert.match(results[0].label, /^Meta Ads only/);
  assert.deepEqual(searchCommandIndex(entries, "   ").length, entries.length);
  assert.deepEqual(searchCommandIndex(entries, "zzzz"), []);
});

test("every account scope is reachable from the palette", () => {
  const accounts = buildCommandIndex({ role: "viewer", platform: "all" }).filter(
    (entry) => entry.group === "Accounts",
  );

  assert.ok(accounts.length >= 5, "all five demo brand scopes must be switchable");
  assert.equal(
    accounts.every((entry) => entry.action.kind === "set-account"),
    true,
  );
});
