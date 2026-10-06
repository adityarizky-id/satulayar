import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildConnectorHealthReport,
  groupMissingSettings,
  resolveLiveSyncGate,
} from "../src/lib/connectors/health";
import {
  hasTimezoneMismatchWarning,
  TIMEZONE_MISMATCH_DISCLAIMER_COPY,
} from "../src/components/dashboard/timezone-mismatch-disclaimer";
import {
  dataStatusTone,
  enumerateDates,
  evaluateDataQuality,
  evaluateTimezoneAlignment,
  isDisclosureOnlyIssue,
  mergeMetricRows,
  metricRowKey,
  utcOffsetMinutes,
} from "../src/lib/dashboard/data-quality";
import { buildDashboardSnapshotFromRows } from "../src/lib/dashboard/fixtures";
import type { DailyMetric, Platform } from "../src/lib/dashboard/types";

const RANGE = { start: "2026-07-01", end: "2026-07-03" };

function row(
  date: string,
  platform: Exclude<Platform, "all">,
  overrides: Partial<DailyMetric> = {},
): DailyMetric {
  return {
    date,
    clientId: "demo",
    accountId: "demo-account",
    platform,
    currency: "USD",
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
    syncedAt: "2026-07-04T05:00:00.000Z",
    isProvisional: false,
    ...overrides,
  };
}

function completeRows(): DailyMetric[] {
  return enumerateDates(RANGE).flatMap((date) => [
    row(date, "meta"),
    row(date, "google"),
  ]);
}

test("full coverage across both platforms is ready and unblocks the summary", () => {
  const report = evaluateDataQuality(completeRows(), RANGE, "all", {
    today: "2026-07-20",
  });

  assert.equal(report.expectedDays, 3);
  assert.equal(report.expectedRowCount, 6);
  assert.equal(report.coveragePercent, 100);
  assert.equal(report.status, "ready");
  assert.equal(report.summaryBlocked, false);
  assert.deepEqual(report.missingDates, []);
  assert.deepEqual(report.issues, []);
});

test("a missing day is reported as partial coverage and blocks the summary", () => {
  const rows = completeRows().filter(
    (item) => !(item.date === "2026-07-02" && item.platform === "google"),
  );
  const report = evaluateDataQuality(rows, RANGE, "all", {
    today: "2026-07-20",
  });

  assert.equal(report.status, "partial");
  assert.equal(report.summaryBlocked, true);
  assert.deepEqual(report.missingDates, ["2026-07-02"]);
  assert.equal(
    report.platformCoverage.find((item) => item.platform === "google")?.status,
    "partial",
  );
  assert.equal(
    report.platformCoverage.find((item) => item.platform === "meta")?.status,
    "ready",
  );
  assert.equal(
    report.issues.some(
      (issue) => issue.code === "missing-date" && issue.platform === "google",
    ),
    true,
  );
});

test("a partial platform response is never counted as complete", () => {
  const report = evaluateDataQuality(
    enumerateDates(RANGE).map((date) => row(date, "meta")),
    RANGE,
    "all",
    { today: "2026-07-20" },
  );

  assert.equal(report.coveragePercent, 50);
  assert.equal(report.status, "blocked");
  assert.equal(
    report.issues.some(
      (issue) =>
        issue.code === "platform-missing" && issue.severity === "blocking",
    ),
    true,
  );
});

test("duplicate metric identities block the gate instead of double counting", () => {
  const rows = [...completeRows(), row("2026-07-01", "meta")];
  const report = evaluateDataQuality(rows, RANGE, "all", {
    today: "2026-07-20",
  });

  assert.equal(report.duplicateKeys.length, 1);
  assert.equal(report.status, "blocked");
  assert.equal(
    report.issues.some((issue) => issue.code === "duplicate-row"),
    true,
  );
});

test("repeating the same refresh is idempotent", () => {
  const stored = completeRows();
  const once = mergeMetricRows(stored, completeRows());
  const twice = mergeMetricRows(once, completeRows());

  assert.equal(once.length, stored.length);
  assert.deepEqual(twice, once);
  assert.equal(
    evaluateDataQuality(twice, RANGE, "all", { today: "2026-07-20" })
      .duplicateKeys.length,
    0,
  );
});

test("a failed pull on one platform keeps the other platform's stored rows", () => {
  const stored = completeRows();
  const metaOnlyRefresh = enumerateDates(RANGE).map((date) =>
    row(date, "meta", { spend: 125, syncedAt: "2026-07-05T05:00:00.000Z" }),
  );
  const merged = mergeMetricRows(stored, metaOnlyRefresh);
  const googleRows = merged.filter((item) => item.platform === "google");
  const metaRows = merged.filter((item) => item.platform === "meta");

  assert.equal(merged.length, 6);
  assert.equal(googleRows.length, 3);
  assert.equal(
    googleRows.every((item) => item.syncedAt === "2026-07-04T05:00:00.000Z"),
    true,
  );
  assert.equal(
    metaRows.every((item) => item.spend === 125),
    true,
  );
});

test("metric identity separates platform, account, connector, and query version", () => {
  const base = row("2026-07-01", "meta");

  assert.notEqual(metricRowKey(base), metricRowKey(row("2026-07-01", "google")));
  assert.notEqual(
    metricRowKey(base),
    metricRowKey(row("2026-07-01", "meta", { sourceQueryVersion: "live-v1" })),
  );
  assert.equal(metricRowKey(base), metricRowKey(row("2026-07-01", "meta")));
});

test("an open current day stays visible as provisional", () => {
  const rows = completeRows().map((item) =>
    item.date === "2026-07-03" ? { ...item, isProvisional: true } : item,
  );
  const report = evaluateDataQuality(rows, RANGE, "all", {
    today: "2026-07-03",
  });

  assert.equal(report.currentDayIncluded, true);
  assert.deepEqual(report.provisionalDates, ["2026-07-03"]);
  assert.equal(
    report.issues.some(
      (issue) => issue.code === "provisional-day" && issue.severity === "warning",
    ),
    true,
  );
  assert.equal(report.status, "ready");
});

test("a snapshot synced before the end of the period is stale", () => {
  const rows = completeRows().map((item) => ({
    ...item,
    syncedAt: "2026-07-02T05:00:00.000Z",
  }));
  const report = evaluateDataQuality(rows, RANGE, "all", {
    today: "2026-07-20",
  });

  assert.equal(report.status, "stale");
  assert.equal(report.lastSyncedAt, "2026-07-02T05:00:00.000Z");
  assert.equal(
    report.issues.some((issue) => issue.code === "stale-sync"),
    true,
  );
});

test("a currency or timezone mismatch blocks the reporting contract", () => {
  const currencyReport = evaluateDataQuality(
    completeRows().map((item, index) =>
      index === 0 ? { ...item, currency: "EUR" as DailyMetric["currency"] } : item,
    ),
    RANGE,
    "all",
    { today: "2026-07-20" },
  );
  const timezoneReport = evaluateDataQuality(
    completeRows().map((item, index) =>
      index === 0 ? { ...item, accountTimezone: "Europe/Madrid" } : item,
    ),
    RANGE,
    "all",
    { today: "2026-07-20" },
  );

  assert.equal(currencyReport.status, "blocked");
  assert.equal(
    currencyReport.issues.some((issue) => issue.code === "currency-mismatch"),
    true,
  );
  assert.equal(timezoneReport.status, "blocked");
  assert.equal(
    timezoneReport.issues.some((issue) => issue.code === "timezone-mismatch"),
    true,
  );
});

test("a non-GBP account is a valid reporting contract, not a mismatch", () => {
  const euroRows = completeRows().map((item) => ({
    ...item,
    currency: "EUR" as DailyMetric["currency"],
    accountTimezone: "Europe/Madrid",
  }));

  const inferredReport = evaluateDataQuality(euroRows, RANGE, "all", {
    today: "2026-07-20",
  });
  const contractedReport = evaluateDataQuality(euroRows, RANGE, "all", {
    today: "2026-07-20",
    expectedCurrency: "EUR",
  });
  const wrongContractReport = evaluateDataQuality(euroRows, RANGE, "all", {
    today: "2026-07-20",
    expectedCurrency: "GBP",
  });

  // The 30 guardrail is native per account, so a consistent EUR scope must pass.
  assert.equal(inferredReport.status, "ready");
  assert.equal(
    inferredReport.issues.some((issue) => issue.code === "currency-mismatch"),
    false,
  );
  assert.equal(contractedReport.status, "ready");

  // An account mapped to the wrong contract currency is still caught.
  assert.equal(wrongContractReport.status, "blocked");
  assert.equal(
    wrongContractReport.issues.some(
      (issue) => issue.code === "currency-mismatch",
    ),
    true,
  );
});

test("live mode keeps the summary blocked even with complete coverage", () => {
  const report = evaluateDataQuality(completeRows(), RANGE, "all", {
    today: "2026-07-20",
    mode: "live",
  });

  assert.equal(report.status, "ready");
  assert.equal(report.summaryBlocked, true);
});

test("the dashboard snapshot exposes the same quality verdict", () => {
  const rows = completeRows().filter(
    (item) => !(item.date === "2026-07-02" && item.platform === "google"),
  );
  const snapshot = buildDashboardSnapshotFromRows(rows, RANGE, "all", {
    mode: "mock",
    storage: "supabase",
  });

  assert.equal(snapshot.dataStatus, "partial");
  assert.equal(snapshot.dataStatus, snapshot.quality.status);
  assert.equal(
    snapshot.dataHealth.coveragePercent,
    snapshot.quality.coveragePercent,
  );
  assert.equal(snapshot.dataHealth.summaryBlocked, true);
  assert.equal(
    snapshot.summary.dataGaps.some((gap) => /missing/i.test(gap)),
    true,
  );
});

test("connector health reports read-only providers without exposing secrets", async () => {
  const report = await buildConnectorHealthReport({
    mode: "mock",
    storage: "fixture",
    environment: { SUPABASE_SERVICE_ROLE_KEY: "never-returned" },
    now: new Date("2026-08-05T00:00:00.000Z"),
  });
  const serialized = JSON.stringify(report);

  assert.equal(report.readOnlyEnforced, true);
  assert.equal(report.liveSyncLocked, true);
  assert.equal(report.platforms.length, 2);
  assert.doesNotMatch(serialized, /never-returned/);

  for (const platform of report.platforms) {
    assert.equal(platform.status, "mock-ready");
    assert.equal(platform.activeProviderId, `${platform.platform}-mock`);
    assert.equal(
      platform.providers.every((provider) => provider.readOnly),
      true,
    );
    assert.equal(
      platform.providers.filter((provider) => provider.activation === "active")
        .length,
      1,
    );
    assert.equal(
      platform.providers
        .slice(1)
        .every((provider) => provider.credentialStatus === "not-selected"),
      true,
    );
    assert.deepEqual(
      platform.providers.slice(1).map((provider) => provider.priority),
      [10, 20, 30],
    );
  }
});

test("live mode activates no provider and keeps live sync locked", async () => {
  const report = await buildConnectorHealthReport({
    mode: "live",
    storage: "supabase",
    environment: {},
    now: new Date("2026-08-05T00:00:00.000Z"),
  });

  assert.equal(report.liveSyncLocked, true);
  for (const platform of report.platforms) {
    assert.equal(platform.activeProviderId, null);
    assert.equal(platform.status, "unavailable");
    assert.equal(
      platform.providers.every((provider) => provider.activation === "locked"),
      true,
    );
  }
});

test("the connector health route requires an editor role and never calls a network", async () => {
  const { readFile } = await import("node:fs/promises");
  const routeSource = await readFile(
    new URL("../src/app/api/connector-health/route.ts", import.meta.url),
    "utf8",
  );
  const healthSource = await readFile(
    new URL("../src/lib/connectors/health.ts", import.meta.url),
    "utf8",
  );

  assert.match(routeSource, /hasPermission\(auth\.context\.access\.role, "sync:trigger"\)/);
  assert.match(routeSource, /privateJson/);
  assert.doesNotMatch(healthSource, /fetch\(|RemoteMcpToolClient/);
});

test("the utility-bar status mark never keeps a healthy tone for an actionable state", () => {
  assert.equal(dataStatusTone("ready"), "positive");
  assert.equal(dataStatusTone("partial"), "warning");
  assert.equal(dataStatusTone("stale"), "warning");
  assert.equal(dataStatusTone("blocked"), "negative");
});

// ------------------------------------------------------------- live sync gate

const UNLOCKED_ENVIRONMENT = {
  DASHBOARD_DATA_MODE: "live",
  DASHBOARD_DATA_STORE: "supabase",
  SUPABASE_SERVICE_ROLE_KEY: "worker-secret",
  GOOGLE_ADS_DEVELOPER_TOKEN: "dev-token",
  GOOGLE_ADS_CLIENT_ID: "client-id",
  GOOGLE_ADS_CLIENT_SECRET: "client-secret",
  GOOGLE_ADS_CUSTOMER_ID: "1234500001",
  GOOGLE_ADS_REGISTRATION_CONVERSION_ACTION_ID: "900000002",
  GOOGLE_ADS_PURCHASE_CONVERSION_ACTION_ID: "900000001",
};

test("the live sync gate stays closed in mock mode", () => {
  const gate = resolveLiveSyncGate({
    ...UNLOCKED_ENVIRONMENT,
    DASHBOARD_DATA_MODE: "mock",
  });

  assert.equal(gate.unlocked, false);
  assert.deepEqual(gate.missing, ["DASHBOARD_DATA_MODE"]);
});

test("the live sync gate stays closed without a durable store", () => {
  const gate = resolveLiveSyncGate({
    ...UNLOCKED_ENVIRONMENT,
    DASHBOARD_DATA_STORE: "fixture",
  });

  assert.equal(gate.unlocked, false);
  assert.deepEqual(gate.missing, ["DASHBOARD_DATA_STORE"]);
});

test("the live sync gate stays closed while the conversion mapping is unset", () => {
  const environment: Record<string, string | undefined> = { ...UNLOCKED_ENVIRONMENT };
  delete environment.GOOGLE_ADS_PURCHASE_CONVERSION_ACTION_ID;

  const gate = resolveLiveSyncGate(environment);

  assert.equal(gate.unlocked, false);
  assert.deepEqual(gate.missing, ["GOOGLE_ADS_PURCHASE_CONVERSION_ACTION_ID"]);
});

test("the live sync gate never names a credential value in its reason", () => {
  const environment: Record<string, string | undefined> = { ...UNLOCKED_ENVIRONMENT };
  delete environment.SUPABASE_SERVICE_ROLE_KEY;
  environment.SUPABASE_SERVICE_ROLE_KEY = "";

  const gate = resolveLiveSyncGate(environment);

  assert.equal(gate.unlocked, false);
  assert.doesNotMatch(gate.reason, /worker-secret|client-secret|dev-token/);
});

test("the live sync gate opens once credentials, mapping, and storage are all set", () => {
  const gate = resolveLiveSyncGate(UNLOCKED_ENVIRONMENT);

  assert.equal(gate.unlocked, true);
  assert.deepEqual(gate.missing, []);
});

test("connector health reports the gate rather than a hardcoded lock", async () => {
  const locked = await buildConnectorHealthReport({
    mode: "live",
    storage: "supabase",
    environment: {},
    now: new Date("2026-09-10T00:00:00.000Z"),
  });
  const unlocked = await buildConnectorHealthReport({
    mode: "live",
    storage: "supabase",
    environment: UNLOCKED_ENVIRONMENT,
    now: new Date("2026-09-10T00:00:00.000Z"),
  });

  assert.equal(locked.liveSyncLocked, true);
  assert.equal(unlocked.liveSyncLocked, false);
  assert.doesNotMatch(JSON.stringify(unlocked), /worker-secret|client-secret/);
  // The panel lists names from the same gate, never a copy of its own.
  assert.equal(locked.liveSyncMissing.length > 0, true);
  assert.deepEqual(unlocked.liveSyncMissing, []);
});

test("missing settings are grouped by the job they do, names only", () => {
  const groups = groupMissingSettings([
    "SUPABASE_SERVICE_ROLE_KEY",
    "GOOGLE_ADS_DEVELOPER_TOKEN",
    "GOOGLE_ADS_CLIENT_ID",
    "GOOGLE_ADS_REGISTRATION_CONVERSION_ACTION_ID",
    "GOOGLE_ADS_PURCHASE_CONVERSION_ACTION_ID",
  ]);

  assert.deepEqual(
    groups.map((group) => group.label),
    ["Storage", "Conversion mapping", "Google Ads API"],
  );
  // Conversion ids share the Google Ads prefix; they must not fall into the
  // credential group, because fixing them is a different operator task.
  assert.deepEqual(
    groups[1].settings.map((setting) => setting.key),
    [
      "GOOGLE_ADS_REGISTRATION_CONVERSION_ACTION_ID",
      "GOOGLE_ADS_PURCHASE_CONVERSION_ACTION_ID",
    ],
  );
  assert.deepEqual(groupMissingSettings([]), []);
});

test("a mode or store gate explains the value it expects", () => {
  const [group] = groupMissingSettings(["DASHBOARD_DATA_MODE"]);

  assert.equal(group.label, "Dashboard runtime");
  assert.deepEqual(group.settings, [
    { key: "DASHBOARD_DATA_MODE", hint: "must be live" },
  ]);
});

test("every MetricSourceConnector is accepted when a stored row is read back", async () => {
  const typesSource = await readFile(
    new URL("../src/lib/dashboard/types.ts", import.meta.url),
    "utf8",
  );
  const serverSource = await readFile(
    new URL("../src/lib/supabase/server.ts", import.meta.url),
    "utf8",
  );

  const union = typesSource
    .split("export type MetricSourceConnector =")[1]
    ?.split(";")[0] ?? "";
  const declared = [...union.matchAll(/"([a-z0-9-]+)"/g)].map((match) => match[1]);

  const allowlist = serverSource
    .split("const METRIC_SOURCE_CONNECTORS = new Set<MetricSourceConnector>([")[1]
    ?.split("]);")[0] ?? "";
  const accepted = [...allowlist.matchAll(/"([a-z0-9-]+)"/g)].map((match) => match[1]);

  assert.ok(declared.length >= 9, "expected the connector union to be parsed");
  // A connector the writer may produce but the reader rejects turns every live
  // row into "Stored metric uses an unsupported connector" at read time. Both
  // direct-API connectors were missing from the runtime allowlist.
  assert.deepEqual(
    declared.filter((connector) => !accepted.includes(connector)),
    [],
    "every declared connector must be accepted by readStoredMetrics",
  );
  assert.ok(accepted.includes("google-direct-api"));
  assert.ok(accepted.includes("meta-direct-api"));
});

test("a single-platform refresh is scored against that platform only", async () => {
  const { SyncPipeline } = await import("../src/lib/connectors/sync-pipeline");

  const range = { start: "2026-07-01", end: "2026-07-03" };
  const result = await new SyncPipeline().runSync({
    clientId: "pilot-client",
    accountKey: "kopi-senja-usd",
    range,
    platforms: ["google"],
    mode: "mock",
  });

  // Asking for Google alone must not raise a blocking `platform-missing` for
  // Meta. That false verdict downgraded a complete Google pull to `partial`
  // and emitted a gate-failure error the caller's own re-scoring contradicted.
  assert.equal(result.dataStatus, "ready");
  assert.equal(result.status, "succeeded");
  assert.deepEqual(result.errors, []);
  assert.ok(result.rows.every((row) => row.platform === "google"));
});

// ------------------------------------------------- UK GMT/BST timezone policy

/** Google reports a UK account as Etc/GMT; Meta reports it as Europe/London. */
function ukPairRows(range: { start: string; end: string }): DailyMetric[] {
  return enumerateDates(range).flatMap((date) => [
    row(date, "google", {
      accountTimezone: "Etc/GMT",
      syncedAt: `${range.end}T23:00:00.000Z`,
    }),
    row(date, "meta", {
      accountTimezone: "Europe/London",
      syncedAt: `${range.end}T23:00:00.000Z`,
    }),
  ]);
}

test("utcOffsetMinutes reads real offsets, including BST, and rejects unknown zones", () => {
  const summer = new Date("2026-07-01T12:00:00Z");
  const winter = new Date("2026-01-15T12:00:00Z");

  assert.equal(utcOffsetMinutes("Europe/London", summer), 60);
  assert.equal(utcOffsetMinutes("Europe/London", winter), 0);
  assert.equal(utcOffsetMinutes("Etc/GMT", summer), 0);
  assert.equal(utcOffsetMinutes("Europe/Berlin", summer), 120);
  assert.equal(utcOffsetMinutes("Mars/Olympus_Mons", summer), null);
  assert.equal(utcOffsetMinutes("", summer), null);
});

test("the UK GMT/BST pair during summer time is a warning, not a blocker", () => {
  const report = evaluateDataQuality(ukPairRows(RANGE), RANGE, "all", {
    today: "2026-07-20",
  });

  // A live failure of this shape would otherwise block publication.
  assert.equal(
    report.issues.some((issue) => issue.code === "timezone-mismatch"),
    false,
  );
  const bst = report.issues.find((issue) => issue.code === "timezone-mismatch-bst");
  assert.ok(bst);
  assert.equal(bst.severity, "warning");
  assert.deepEqual(bst.dates, ["2026-07-01", "2026-07-02", "2026-07-03"]);
  assert.match(bst.safeMessage, /Google Ads \(Etc\/GMT\) and Meta Ads \(Europe\/London\)/);
  assert.match(bst.safeMessage, /British Summer Time/);
  assert.equal(report.status, "ready");

  assert.deepEqual(report.timezoneAlignment, {
    status: "uk-summer-time-offset",
    platformTimezones: [
      { platform: "google", timezone: "Etc/GMT" },
      { platform: "meta", timezone: "Europe/London" },
    ],
    maxOffsetMinutes: 60,
    offsetDates: ["2026-07-01", "2026-07-02", "2026-07-03"],
  });
});

test("the UK GMT/BST pair in winter has identical days and raises nothing", () => {
  const winter = { start: "2026-01-12", end: "2026-01-14" };
  const report = evaluateDataQuality(ukPairRows(winter), winter, "all", {
    today: "2026-02-01",
  });

  assert.deepEqual(report.issues, []);
  assert.equal(report.status, "ready");
  assert.equal(report.timezoneAlignment.status, "equivalent");
  assert.equal(report.timezoneAlignment.maxOffsetMinutes, 0);
  assert.deepEqual(report.timezoneAlignment.offsetDates, []);
});

test("only the days whose boundaries really differ are flagged across a clock change", () => {
  // BST ends 01:00 UTC on Sunday 2026-10-25 and starts on Sunday 2026-03-29.
  const autumn = { start: "2026-10-24", end: "2026-10-26" };
  const spring = { start: "2026-03-28", end: "2026-03-30" };

  assert.deepEqual(
    evaluateTimezoneAlignment(ukPairRows(autumn), enumerateDates(autumn)).offsetDates,
    ["2026-10-24", "2026-10-25"],
  );
  assert.deepEqual(
    evaluateTimezoneAlignment(ukPairRows(spring), enumerateDates(spring)).offsetDates,
    ["2026-03-29", "2026-03-30"],
  );
});

test("the BST tolerance never extends to other European pairs", () => {
  const londonBerlin = evaluateDataQuality(
    completeRows().map((item) =>
      item.platform === "google" ? { ...item, accountTimezone: "Europe/Berlin" } : item,
    ),
    RANGE,
    "all",
    { today: "2026-07-20" },
  );
  // Berlin and Paris share every offset, yet the gate was never widened past
  // the UK pair: a mixed-zone scope can also mean a wrongly mapped account.
  const berlinParis = evaluateDataQuality(
    completeRows().map((item) => ({
      ...item,
      accountTimezone: item.platform === "google" ? "Europe/Berlin" : "Europe/Paris",
    })),
    RANGE,
    "all",
    { today: "2026-07-20" },
  );

  for (const report of [londonBerlin, berlinParis]) {
    assert.equal(report.status, "blocked");
    assert.equal(report.timezoneAlignment.status, "incompatible");
    assert.equal(
      report.issues.some(
        (issue) => issue.code === "timezone-mismatch" && issue.severity === "blocking",
      ),
      true,
    );
    assert.equal(
      report.issues.some((issue) => issue.code === "timezone-mismatch-bst"),
      false,
    );
  }
});

test("an unresolvable timezone next to a UK zone still blocks", () => {
  const report = evaluateDataQuality(
    ukPairRows(RANGE).map((item) =>
      item.platform === "meta" ? { ...item, accountTimezone: "Europe/Londn" } : item,
    ),
    RANGE,
    "all",
    { today: "2026-07-20" },
  );

  assert.equal(report.status, "blocked");
  assert.equal(report.timezoneAlignment.status, "incompatible");
  assert.equal(report.timezoneAlignment.maxOffsetMinutes, null);
});

test("the BST warning is disclosure-only and every other warning still counts", () => {
  const report = evaluateDataQuality(ukPairRows(RANGE), RANGE, "all", {
    today: "2026-07-20",
  });
  const bst = report.issues.find((issue) => issue.code === "timezone-mismatch-bst");
  assert.ok(bst);
  assert.equal(isDisclosureOnlyIssue(bst), true);

  for (const code of ["missing-date", "provisional-day", "stale-sync"] as const) {
    assert.equal(
      isDisclosureOnlyIssue({ ...bst, code }),
      false,
      `${code} must keep marking a refresh partial`,
    );
  }
});

test("a google+meta refresh on the UK GMT/BST pair completes and publishes", async () => {
  const { SyncPipeline } = await import("../src/lib/connectors/sync-pipeline");
  const rows = ukPairRows(RANGE);
  const fakeConnector = (platform: "google" | "meta") => ({
    providerId: `${platform}-direct-api`,
    providerKind: "official-api" as const,
    platform,
    mode: "live" as const,
    health: async () => ({
      providerId: `${platform}-direct-api`,
      providerKind: "official-api" as const,
      available: true,
      authenticated: true,
      readOnly: true,
      safeMessage: "Authenticated.",
    }),
    fetchDailyMetrics: async () => ({
      platform,
      rows: rows.filter((item) => item.platform === platform),
      providerId: `${platform}-direct-api`,
      sourceQueryVersion: "live-test",
      coveragePercent: 100,
      warnings: [],
      attempts: [],
    }),
  });

  const pipeline = new SyncPipeline();
  // Swap the connector factory for this instance only; no network is touched.
  (pipeline as unknown as { getConnector: typeof fakeConnector }).getConnector =
    fakeConnector;

  const result = await pipeline.runSync({
    clientId: "pilot-client",
    accountKey: "google-live-v1",
    range: RANGE,
    platforms: ["google", "meta"],
    mode: "live",
  });

  assert.equal(result.status, "succeeded");
  assert.equal(result.dataStatus, "ready");
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows.length, 6);
});

test("persistLiveSync and the sync route carry the disclaimer instead of 'incomplete coverage'", async () => {
  const serverSource = await readFile(
    new URL("../src/lib/supabase/server.ts", import.meta.url),
    "utf8",
  );
  const routeSource = await readFile(
    new URL("../src/app/api/sync-jobs/route.ts", import.meta.url),
    "utf8",
  );

  // A job whose only issue is the BST disclaimer received every row, so it
  // must not be stored as `partial` ("Refresh completed with incomplete coverage").
  assert.match(
    serverSource,
    /quality\.issues\.some\(\(issue\) => !isDisclosureOnlyIssue\(issue\)\)/,
  );
  assert.doesNotMatch(serverSource, /execution\.errors\.length > 0 \|\| quality\.issues\.length > 0/);
  assert.match(serverSource, /timezone_alignment: quality\.timezoneAlignment\.status/);
  assert.match(routeSource, /qualityIssues: result\.qualityIssues/);
  assert.match(routeSource, /timezoneAlignment: result\.timezoneAlignment/);
});

test("the dashboard snapshot carries the BST disclaimer and stays publishable", () => {
  const snapshot = buildDashboardSnapshotFromRows(ukPairRows(RANGE), RANGE, "all", {
    mode: "mock",
    storage: "supabase",
  });

  assert.notEqual(snapshot.dataStatus, "blocked");
  assert.equal(snapshot.quality.timezoneAlignment.status, "uk-summer-time-offset");
  assert.equal(
    snapshot.summary.dataGaps.some((gap) => /British Summer Time/.test(gap)),
    true,
  );
});

test("the visual disclaimer responds only to the non-blocking BST warning", () => {
  const bstWarning = {
    code: "timezone-mismatch-bst" as const,
    severity: "warning" as const,
  };

  assert.equal(hasTimezoneMismatchWarning([bstWarning]), true);
  assert.equal(
    hasTimezoneMismatchWarning([{ ...bstWarning, severity: "blocking" }]),
    false,
  );
  assert.equal(hasTimezoneMismatchWarning([]), false);
  assert.equal(
    TIMEZONE_MISMATCH_DISCLAIMER_COPY,
    "Google (GMT) and Meta (BST) daily boundaries shift by 1 hour due to British Summer Time. Aggregated daily figures reflect this boundary alignment.",
  );
});

test("asking for both platforms still fails closed when one is absent", () => {
  const rows = [
    row("2026-07-01", "google"),
    row("2026-07-02", "google"),
    row("2026-07-03", "google"),
  ];

  const report = evaluateDataQuality(rows, RANGE, "all");

  assert.equal(
    report.issues.some(
      (issue) => issue.code === "platform-missing" && issue.severity === "blocking",
    ),
    true,
  );
});
