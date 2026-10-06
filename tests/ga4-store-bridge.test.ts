import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { resolveAccount } from "@/lib/dashboard/accounts";
import {
  applyGa4StoreBridge,
  GA4_TO_STORE_MAPPING,
  isGa4DailyRow,
  mapGa4ChannelGrouping,
  type Ga4DailyRow,
} from "@/lib/store/ga4-contract";
import {
  buildStoreAnalyticsSnapshot,
  storeForAccount,
} from "@/lib/store/analytics";

const RANGE = { start: "2026-09-01", end: "2026-09-03" };

function snapshot() {
  return buildStoreAnalyticsSnapshot(RANGE, {
    store: storeForAccount(resolveAccount("kopi-senja")),
    now: new Date("2026-09-04T09:00:00.000Z"),
  });
}

function row(
  date: string,
  overrides: Partial<Ga4DailyRow> = {},
): Ga4DailyRow {
  return {
    date,
    breakdown: "total",
    breakdownValue: "total",
    sessions: 100,
    activeUsers: 80,
    bounceRate: 0.4,
    averageSessionDurationSeconds: 70,
    addToCarts: 25,
    checkouts: 10,
    ecommercePurchases: 5,
    grossPurchaseRevenue: 400,
    currency: "USD",
    isProvisional: false,
    ...overrides,
  };
}

function totalRows(): Ga4DailyRow[] {
  return ["2026-09-01", "2026-09-02", "2026-09-03"].map((date) =>
    row(date),
  );
}

test("the formal map targets StoreSession semantics without fabricating session rows", () => {
  assert.equal(GA4_TO_STORE_MAPPING.sessions.semanticTarget, "StoreSession");
  assert.equal(GA4_TO_STORE_MAPPING.sessions.materialization, "aggregate-only");
  assert.equal(
    GA4_TO_STORE_MAPPING.ecommercePurchases.snapshotTarget,
    "conversionFunnel.placedOrders",
  );
});

test("the row validator rejects malformed dates, negative counts, and invalid rates", () => {
  assert.equal(isGa4DailyRow(row("2026-09-01")), true);
  assert.equal(isGa4DailyRow(row("2026-02-30")), false);
  assert.equal(isGa4DailyRow(row("2026-09-01", { sessions: -1 })), false);
  assert.equal(isGa4DailyRow(row("2026-09-01", { bounceRate: 1.1 })), false);
});

test("GA4 channel groups collapse onto the Store referring-channel vocabulary", () => {
  assert.equal(mapGa4ChannelGrouping("Direct"), "Direct");
  assert.equal(mapGa4ChannelGrouping("Paid Search"), "Paid");
  assert.equal(mapGa4ChannelGrouping("Cross-network"), "Paid");
  assert.equal(mapGa4ChannelGrouping("Organic Search"), "Organic");
  assert.equal(mapGa4ChannelGrouping("Organic Social"), "Social");
  assert.equal(mapGa4ChannelGrouping("Unassigned"), "Unknown");
});

test("full coverage replaces traffic series, funnel counts, and channel sessions", () => {
  const rows = totalRows().flatMap((total) => [
    total,
    row(total.date, {
      breakdown: "channel",
      breakdownValue: "Paid Search",
      sessions: 60,
    }),
    row(total.date, {
      breakdown: "channel",
      breakdownValue: "Organic Search",
      sessions: 40,
    }),
  ]);
  const result = applyGa4StoreBridge(snapshot(), rows);

  assert.equal(result.applied, true);
  assert.equal(result.quality.status, "ready");
  assert.equal(result.quality.anomalyEvaluation, "enabled");
  assert.equal(result.quality.currencyStatus, "matched");
  assert.equal(result.quality.monetaryFieldsApplied, false);

  assert.equal(
    result.snapshot.kpis.find((kpi) => kpi.key === "sessions")?.value,
    300,
  );
  assert.deepEqual(
    result.snapshot.sessionsOverTime.points.map((point) => point.value),
    [100, 100, 100],
  );
  assert.equal(result.snapshot.sessionsOverTime.total, 300);
  assert.equal(result.snapshot.conversionRateOverTime.total, 0.05);

  assert.deepEqual(
    result.snapshot.conversionFunnel.map((step) => [step.label, step.sessions]),
    [
      ["Sessions", 300],
      ["Added to cart", 75],
      ["Reached checkout", 30],
      ["Placed orders", 15],
    ],
  );

  const paid = result.snapshot.performanceByReferringChannel.find(
    (channel) => channel.channel === "Paid",
  );
  const organic = result.snapshot.performanceByReferringChannel.find(
    (channel) => channel.channel === "Organic",
  );
  assert.equal(paid?.sessions, 180);
  assert.equal(organic?.sessions, 120);
});

test("one missing day blocks the bridge instead of mixing live and dummy totals", () => {
  const base = snapshot();
  const result = applyGa4StoreBridge(base, totalRows().slice(0, 2));

  assert.equal(result.applied, false);
  assert.equal(result.snapshot, base);
  assert.equal(result.quality.status, "blocked");
  assert.deepEqual(result.quality.missingDays, ["2026-09-03"]);
  assert.equal(result.quality.anomalyEvaluation, "suppressed");
});

test("duplicate total rows block double counting", () => {
  const rows = [...totalRows(), row("2026-09-02")];
  const result = applyGa4StoreBridge(snapshot(), rows);

  assert.equal(result.applied, false);
  assert.deepEqual(result.quality.duplicateTotalDays, ["2026-09-02"]);
});

test("only the final day may be provisional and it suppresses anomaly verdicts", () => {
  const allowed = totalRows();
  allowed[2] = row("2026-09-03", { isProvisional: true });
  const provisional = applyGa4StoreBridge(snapshot(), allowed);

  assert.equal(provisional.applied, true);
  assert.equal(provisional.quality.status, "provisional");
  assert.equal(provisional.quality.anomalyEvaluation, "suppressed");
  assert.deepEqual(provisional.quality.provisionalDays, ["2026-09-03"]);

  const invalid = totalRows();
  invalid[0] = row("2026-09-01", { isProvisional: true });
  const blocked = applyGa4StoreBridge(snapshot(), invalid);
  assert.equal(blocked.applied, false);
  assert.match(blocked.warnings.join(" "), /Only the range end may be provisional/);
});

test("currency mismatch keeps counts usable and refuses every monetary overwrite", () => {
  const base = snapshot();
  const rows = totalRows().map((item) => ({ ...item, currency: "EUR" }));
  const result = applyGa4StoreBridge(base, rows);

  assert.equal(result.applied, true);
  assert.equal(result.quality.currencyStatus, "mismatch");
  assert.equal(result.quality.monetaryFieldsApplied, false);
  assert.equal(
    result.snapshot.kpis.find((kpi) => kpi.key === "sessions")?.value,
    300,
  );
  assert.deepEqual(result.snapshot.salesOverTime, base.salesOverTime);
  assert.deepEqual(result.snapshot.salesBreakdown, base.salesBreakdown);
  assert.match(result.warnings.join(" "), /currency is mismatch/);
});

test("an invalid row blocks the whole selected range", () => {
  const rows = totalRows();
  rows[1] = { ...rows[1], sessions: Number.NaN };
  const result = applyGa4StoreBridge(snapshot(), rows);

  assert.equal(result.applied, false);
  assert.deepEqual(result.quality.invalidRowIndexes, [1]);
});

test("a non-monotonic event funnel is withheld rather than clamped", () => {
  const base = snapshot();
  const rows = totalRows().map((item) => ({ ...item, addToCarts: 120 }));
  const result = applyGa4StoreBridge(base, rows);

  assert.equal(result.applied, true, "traffic counts remain safe to apply");
  assert.equal(result.quality.funnelStatus, "blocked_non_monotonic");
  assert.deepEqual(result.snapshot.conversionFunnel, base.conversionFunnel);
  assert.equal(
    result.snapshot.kpis.find((kpi) => kpi.key === "sessions")?.value,
    300,
  );
});

test("the store bridge has no dependency on connector, Supabase, or UI modules", async () => {
  const source = await readFile(
    new URL("../src/lib/store/ga4-contract.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /@\/lib\/connectors\//);
  assert.doesNotMatch(source, /@\/lib\/supabase\//);
  assert.doesNotMatch(source, /@\/components\//);
  assert.doesNotMatch(source, /ga4-hydration/);
});
