import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDeviceAnalysis,
  buildDeviceAnalysisFromRows,
  DEVICE_LABELS,
  GOOGLE_DEVICE_ENUM,
  type StoredDeviceRow,
} from "../src/lib/dashboard/device";
import {
  buildDashboardSnapshot,
  buildDashboardSnapshotFromRows,
} from "../src/lib/dashboard/fixtures";

const RANGE = { start: "2026-07-01", end: "2026-07-14" };

function analysis(overrides: Partial<Parameters<typeof buildDeviceAnalysis>[0]> = {}) {
  return buildDeviceAnalysis({
    range: RANGE,
    currency: "GBP",
    googleSpend: 1_000,
    googleImpressions: 100_000,
    googleClicks: 4_000,
    googlePurchases: 100,
    googleRegistrations: 400,
    googlePurchaseValue: 5_000,
    ...overrides,
  });
}

test("a device with no orders reports no revenue and no ROAS figure", () => {
  // Connected TV rounds to zero purchases at this volume, and used to still
  // report purchase value and a ROAS derived from it.
  const report = analysis({ googlePurchases: 20, googlePurchaseValue: 1_000 });

  for (const row of report.rows) {
    if (row.purchases === 0) {
      assert.equal(row.purchaseValue, 0, `${row.label} invented revenue`);
      assert.equal(row.costPerPurchase, null);
    }
  }

  // Revenue across devices still reconciles to whole orders, never a fraction.
  const revenue = report.rows.reduce((total, row) => total + row.purchaseValue, 0);
  assert.ok(revenue > 0);
});

test("click-through rate actually differs between devices", () => {
  const report = analysis();
  const rates = report.rows
    .map((row) => row.ctr)
    .filter((value): value is number => value !== null);

  assert.equal(rates.length, 4);
  // Impression share used to track click share, so every device landed on the
  // same 2% and the CTR column looked broken.
  const spread = Math.max(...rates) - Math.min(...rates);
  assert.ok(
    spread > 0.005,
    `CTR spread is only ${(spread * 100).toFixed(2)} points`,
  );
});

test("Google's device enum maps onto the four devices reported", () => {
  assert.equal(GOOGLE_DEVICE_ENUM.MOBILE, "mobile");
  assert.equal(GOOGLE_DEVICE_ENUM.CONNECTED_TV, "connectedTv");
  assert.equal(Object.keys(DEVICE_LABELS).length, 4);
});

test("shares add up and the split preserves the totals it was given", () => {
  const report = analysis();
  const spendSum = report.rows.reduce((total, row) => total + row.spend, 0);
  const shareSum = report.rows.reduce((total, row) => total + row.spendShare, 0);

  assert.equal(Math.abs(shareSum - 1) < 0.001, true);
  assert.equal(Math.abs(spendSum - 1_000) < 1, true);
  assert.equal(Math.abs(report.totals.spend - 1_000) < 1, true);
  assert.equal(Math.abs(report.totals.purchases - 100) <= 2, true);
});

test("the efficiency gap is purchase share minus spend share", () => {
  const report = analysis();

  for (const row of report.rows) {
    assert.equal(
      Math.abs(row.efficiencyGap - (row.purchaseShare - row.spendShare)) < 0.001,
      true,
    );
  }
  // The gaps are a redistribution, so they cancel out across devices.
  assert.equal(
    Math.abs(report.rows.reduce((total, row) => total + row.efficiencyGap, 0)) <
    0.001,
    true,
  );
});

test("the panel names the device that is subsidised and the one that pays for it", () => {
  const report = analysis();

  assert.equal(report.biggestSubsidy?.device, "mobile");
  assert.equal(report.biggestBargain?.device, "desktop");
  assert.equal((report.biggestSubsidy?.efficiencyGap ?? 0) < 0, true);
  assert.match(report.safeMessage, /bid adjustment/i);
});

test("cost per order follows each device's own spend and purchases", () => {
  const report = analysis();

  for (const row of report.rows) {
    if (row.purchases === 0) {
      assert.equal(row.costPerPurchase, null);
      continue;
    }
    assert.equal(
      Math.abs((row.costPerPurchase ?? 0) - row.spend / row.purchases) < 0.01,
      true,
    );
  }
  // Mobile buys the clicks but closes fewer orders, so its CPO must be worse.
  const mobile = report.rows.find((row) => row.device === "mobile");
  const desktop = report.rows.find((row) => row.device === "desktop");
  assert.equal(
    (mobile?.costPerPurchase ?? 0) > (desktop?.costPerPurchase ?? 0),
    true,
  );
});

test("a zero-conversion account reports no rate instead of a fabricated one", () => {
  const report = analysis({
    googlePurchases: 0,
    googleRegistrations: 0,
    googlePurchaseValue: 0,
  });

  assert.equal(
    report.rows.every((row) => row.costPerPurchase === null),
    true,
  );
  assert.equal(
    report.rows.every((row) => row.returnOnAdSpend === 0 || row.returnOnAdSpend === null),
    true,
  );
  // With nothing to attribute, naming a "subsidised" device would be a fiction.
  assert.equal(report.biggestSubsidy, null);
  assert.equal(report.biggestBargain, null);
  assert.match(report.safeMessage, /no purchases landed/i);
});

test("the device cut disappears when Google is filtered out", () => {
  assert.equal(buildDashboardSnapshot(RANGE, "meta").devices, null);
  assert.notEqual(buildDashboardSnapshot(RANGE, "google").devices, null);
  assert.notEqual(buildDashboardSnapshot(RANGE, "all").devices, null);
});

test("the device cut carries the selected comparison period", () => {
  const report = buildDashboardSnapshot(RANGE, "google");

  assert.equal(report.comparisonEnabled, true);
  assert.deepEqual(report.comparisonDevices?.range, report.comparisonRange);
  assert.equal(report.comparisonDevices?.rows.length, report.devices?.rows.length);
  assert.notEqual(
    report.comparisonDevices?.totals.spend,
    report.devices?.totals.spend,
  );
  const currentMobile = report.devices?.rows.find(
    (row) => row.device === "mobile",
  );
  const comparisonMobile = report.comparisonDevices?.rows.find(
    (row) => row.device === "mobile",
  );
  assert.notEqual(currentMobile?.spendShare, comparisonMobile?.spendShare);
  assert.notEqual(currentMobile?.purchaseShare, comparisonMobile?.purchaseShare);
});

test("turning comparison off withholds the previous device series", () => {
  const report = buildDashboardSnapshot(
    RANGE,
    "google",
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    false,
  );

  assert.equal(report.comparisonEnabled, false);
  assert.equal(report.comparisonDevices, null);
});

// ------------------------------------------- measured rows from ad_device_daily

function storedRow(
  device: string,
  overrides: Partial<StoredDeviceRow> = {},
): StoredDeviceRow {
  return {
    date: "2026-07-01",
    device,
    spend: 0,
    impressions: 0,
    clicks: 0,
    registrations: 0,
    purchases: 0,
    purchaseValue: 0,
    ...overrides,
  };
}

test("measured device rows are summed per device, not modelled from account totals", () => {
  // Shaped after the first live backfill: desktop takes a fraction of mobile's
  // clicks and still returns more of the purchases. The modelled split assumes
  // roughly the opposite, which is why it may not clear the pending gate.
  const measured = buildDeviceAnalysisFromRows({
    range: RANGE,
    currency: "GBP",
    rows: [
      storedRow("MOBILE", { spend: 700, clicks: 5_000, purchases: 19, impressions: 90_000 }),
      storedRow("MOBILE", { spend: 100, clicks: 800, purchases: 2, impressions: 10_000 }),
      storedRow("DESKTOP", { spend: 250, clicks: 470, purchases: 44, impressions: 8_000, purchaseValue: 3_000 }),
    ],
  });

  assert.equal(measured.basis, "measured");
  const mobile = measured.rows.find((row) => row.device === "mobile");
  const desktop = measured.rows.find((row) => row.device === "desktop");

  // Two mobile rows fold into one.
  assert.equal(mobile?.spend, 800);
  assert.equal(mobile?.clicks, 5_800);
  assert.equal(mobile?.purchases, 21);
  assert.equal(desktop?.purchases, 44);

  // The diagnostic this panel exists for: mobile takes the spend, desktop
  // returns the orders.
  assert.ok((mobile?.efficiencyGap ?? 0) < 0, "mobile is subsidised");
  assert.ok((desktop?.efficiencyGap ?? 0) > 0, "desktop is the bargain");
  assert.equal(measured.biggestSubsidy?.device, "mobile");
  assert.equal(measured.biggestBargain?.device, "desktop");
});

test("a device Google reports but this dashboard does not model is carried, never dropped", () => {
  // `OTHER` is small but real. Dropping it silently is what makes a device
  // table stop reconciling with the account total it sits beside.
  const measured = buildDeviceAnalysisFromRows({
    range: RANGE,
    currency: "GBP",
    rows: [
      storedRow("DESKTOP", { spend: 100, clicks: 50, purchases: 5 }),
      storedRow("OTHER", { spend: 1.32, clicks: 12 }),
    ],
  });

  assert.equal(measured.unmapped?.spend, 1.32);
  assert.equal(measured.unmapped?.clicks, 12);
  // It is not folded into a modelled device either.
  assert.equal(measured.totals.spend, 100);
  assert.equal(
    measured.rows.reduce((total, row) => total + row.spend, 0),
    measured.totals.spend,
    "the rows must sum to the reported total",
  );
});

test("every modelled device keeps a row at zero so the table does not change shape", () => {
  const measured = buildDeviceAnalysisFromRows({
    range: RANGE,
    currency: "GBP",
    rows: [storedRow("MOBILE", { spend: 10, clicks: 5 })],
  });

  assert.equal(measured.rows.length, Object.keys(DEVICE_LABELS).length);
  assert.equal(measured.unmapped, null);
  // No purchases anywhere: nothing may be called efficient or wasteful yet.
  assert.equal(measured.biggestSubsidy, null);
  assert.match(measured.safeMessage, /No purchases landed/);
});

test("stored device rows lift the panel out of the pending list in live mode", () => {
  const metric = {
    date: "2026-07-01",
    clientId: "demo",
    accountId: "demo",
    platform: "google" as const,
    currency: "GBP" as const,
    accountTimezone: "Europe/London",
    spend: 100,
    impressions: 10_000,
    clicks: 200,
    landingPageViews: 160,
    registrations: 20,
    purchases: 5,
    platformConversionValue: 400,
    actualPurchaseRevenue: 300,
    sourceConnector: "google-direct-api" as const,
    sourceQueryVersion: "v1",
    syncedAt: "2026-07-02T00:00:00.000Z",
    isProvisional: false,
  };

  // Live mode withholds every modelled panel. Without measured rows the device
  // cut stays pending, because the modelled split is not safe to act on.
  const withheld = buildDashboardSnapshotFromRows([metric], RANGE, "google", {
    mode: "live",
    storage: "supabase",
  });
  assert.ok(
    withheld.pendingPanels.some((panel) => panel.key === "device-analysis"),
    "a live snapshot with no device rows must keep the panel pending",
  );
  assert.equal(withheld.devices, null);

  // Measured rows clear it, and the panel says so.
  const hydrated = buildDashboardSnapshotFromRows([metric], RANGE, "google", {
    mode: "live",
    storage: "supabase",
    deviceRows: [
      storedRow("MOBILE", { spend: 70, clicks: 180, purchases: 1 }),
      storedRow("DESKTOP", { spend: 30, clicks: 20, purchases: 4 }),
    ],
  });
  assert.ok(
    !hydrated.pendingPanels.some((panel) => panel.key === "device-analysis"),
    "measured rows must clear the pending placeholder",
  );
  assert.equal(hydrated.devices?.basis, "measured");
  assert.equal(hydrated.devices?.totals.spend, 100);
});

