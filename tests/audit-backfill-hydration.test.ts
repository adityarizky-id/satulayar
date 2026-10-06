import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { sanitiseAuditDetail } from "@/lib/audit/activity-log";
import {
  BACKFILL_LOOKBACKS,
  BACKFILL_LOOKBACK_OPTIONS,
  isBackfillLookback,
  resolveBackfillWindow,
} from "@/lib/connectors/backfill";
import { buildStoreAnalyticsSnapshot, storeForAccount } from "@/lib/store/analytics";
import { applyGa4Hydration, type Ga4StoredRow } from "@/lib/store/ga4-hydration";
import { resolveAccount } from "@/lib/dashboard/accounts";

// --------------------------------------------------------------- audit trail

test("the audit trail redacts anything that looks like PII or a credential", () => {
  const safe = sanitiseAuditDetail({
    lookback: "30d",
    rowCount: 420,
    email: "buyer@example.test",
    customerPhone: "+447911123456",
    refresh_token: "secret-value",
    Zip: "S1 2HB",
    nested: { anything: "at all" },
    platforms: ["meta", "google"],
  });

  assert.equal(safe.lookback, "30d");
  assert.equal(safe.rowCount, 420);
  assert.deepEqual(safe.platforms, ["meta", "google"]);
  // A log that leaks what it was auditing turns one incident into two.
  assert.equal(safe.email, "[redacted]");
  assert.equal(safe.customerPhone, "[redacted]");
  assert.equal(safe.refresh_token, "[redacted]");
  assert.equal(safe.Zip, "[redacted]");
  // An object could carry anything at all, so it never survives intact.
  assert.equal(safe.nested, "[omitted]");
});

test("the audit table is append-only by construction", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/0007_activity_audit_log.sql", import.meta.url),
    "utf8",
  );

  assert.match(migration, /alter table public\.activity_audit_log enable row level security/);
  assert.match(migration, /create policy activity_audit_member_select/);
  assert.match(migration, /for select to authenticated/);
  // No write, update, or delete policy at all: not even the actor can edit or
  // erase their own row through a browser session.
  assert.doesNotMatch(migration, /for (insert|update|delete)/);
  assert.match(migration, /action in \(/);
});

test("every server action that moves or exports data writes a trail entry", async () => {
  const sources = await Promise.all(
    [
      "../src/app/api/sync-jobs/route.ts",
      "../src/app/api/cron/daily-sync/route.ts",
      "../src/app/api/connectors/backfill/route.ts",
      "../src/app/api/connectors/disconnect/route.ts",
      "../src/app/api/connectors/oauth/[platform]/callback/route.ts",
    ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
  );

  const actions = [
    "sync.manual",
    "sync.scheduled",
    "sync.backfill",
    "connector.disconnected",
    "connector.connected",
  ];

  sources.forEach((source, index) => {
    assert.match(source, /recordAuditEvent\(/, `source ${index} records nothing`);
    assert.match(source, new RegExp(actions[index].replace(".", "\\.")));
  });
});

// ------------------------------------------------------------------ backfill

test("the backfill lookback is a fixed allowlist, not a free-form day count", () => {
  // `BACKFILL_LOOKBACKS` still means "name to a fixed day count". `ytd` has no
  // fixed length, so it is a named option rather than a member of that map.
  assert.deepEqual(Object.keys(BACKFILL_LOOKBACKS), ["7d", "30d", "60d", "90d"]);
  assert.deepEqual(BACKFILL_LOOKBACK_OPTIONS, ["7d", "30d", "60d", "90d", "ytd"]);

  for (const value of ["7d", "30d", "60d", "90d", "ytd"]) {
    assert.equal(isBackfillLookback(value), true);
  }
  // An arbitrary lookback is how someone asks a platform for two years of data
  // and rate-limits the connector for everyone else. `ytd` is bounded by the
  // calendar; "365d" and friends are not offered.
  for (const value of ["365d", "1d", 30, "", null, undefined, "30D", "YTD", "ytd "]) {
    assert.equal(isBackfillLookback(value), false);
  }
});

test("a ytd backfill runs from 1 January of the window's own year", () => {
  // Mid-year: 1 January through yesterday, in the account timezone.
  const midYear = resolveBackfillWindow(
    "ytd",
    "Europe/Madrid",
    new Date("2026-09-18T09:00:00.000Z"),
  );
  assert.equal(midYear.start, "2026-01-01");
  assert.equal(midYear.end, "2026-09-17");

  // The account timezone, not UTC, decides which day "yesterday" is. At 23:30
  // UTC it is already tomorrow in Madrid but still today on GMT, so the two
  // brands end their window a day apart from the same instant.
  const instant = new Date("2026-03-01T23:30:00.000Z");
  assert.equal(resolveBackfillWindow("ytd", "Europe/Madrid", instant).end, "2026-03-01");
  assert.equal(resolveBackfillWindow("ytd", "Etc/GMT", instant).end, "2026-02-28");

  // On 1 January "yesterday" is 31 December, so the year comes from the end of
  // the window. Anchoring to today would produce a range that starts after it
  // ends; anchoring to `end` returns the year that just closed, in full.
  const newYear = resolveBackfillWindow(
    "ytd",
    "Europe/London",
    new Date("2027-01-01T12:00:00.000Z"),
  );
  assert.equal(newYear.start, "2026-01-01");
  assert.equal(newYear.end, "2026-12-31");
  assert.ok(newYear.start <= newYear.end);
});

test("a backfill window ends yesterday in the account timezone", () => {
  const window = resolveBackfillWindow(
    "30d",
    "Europe/London",
    new Date("2026-09-12T00:30:00.000Z"),
  );

  assert.equal(window.end, "2026-09-11");
  assert.equal(window.start, "2026-08-13");

  const ninety = resolveBackfillWindow(
    "90d",
    "Europe/London",
    new Date("2026-09-12T00:30:00.000Z"),
  );
  assert.equal(ninety.end, "2026-09-11");
  assert.equal(ninety.start, "2026-06-14");

  // Sixty inclusive days, so the window carries a full reporting period plus
  // the equal-length baseline every comparison panel needs.
  const sixty = resolveBackfillWindow(
    "60d",
    "Europe/London",
    new Date("2026-09-12T00:30:00.000Z"),
  );
  assert.equal(sixty.end, "2026-09-11");
  assert.equal(sixty.start, "2026-07-14");
});

test("the backfill route is permission-gated and fails closed", async () => {
  const routeSource = await readFile(
    new URL("../src/app/api/connectors/backfill/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(routeSource, /hasPermission\(auth\.context\.access\.role, "sync:trigger"\)/);
  assert.match(routeSource, /isSameOriginRequest\(request\)/);
  assert.match(routeSource, /isBackfillLookback\(body\.lookback\)/);
  assert.match(routeSource, /resolveLiveSyncGate\(\)/);
  assert.match(routeSource, /configuration\.mode !== "live"/);
  // Same ingestion path as the daily refresh, so the upsert contract carries
  // the idempotency rather than the route inventing its own.
  assert.match(routeSource, /persistLiveSync\(/);
});

// --------------------------------------------------------- GA4 hydration

const RANGE = { start: "2026-09-01", end: "2026-09-03" };

function snapshot() {
  return buildStoreAnalyticsSnapshot(RANGE, {
    store: storeForAccount(resolveAccount("kopi-senja")),
    now: new Date("2026-09-04T09:00:00.000Z"),
  });
}

function ga4Row(
  date: string,
  overrides: Partial<Ga4StoredRow> = {},
): Ga4StoredRow {
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
    isProvisional: false,
    ...overrides,
  };
}

test("with no stored GA4 rows the page keeps its synthetic figures", () => {
  const base = snapshot();
  const result = applyGa4Hydration(base, []);

  assert.equal(result.summary.hydrated, false);
  assert.equal(result.snapshot, base, "the snapshot must pass through untouched");
  assert.match(result.summary.reason ?? "", /No GA4 rows are stored/);
});

test("partial coverage is refused rather than mixed into one total", () => {
  const result = applyGa4Hydration(snapshot(), [ga4Row("2026-09-01")]);

  assert.equal(result.summary.hydrated, false);
  assert.equal(result.summary.coveredDays, 1);
  assert.equal(result.summary.expectedDays, 3);
  // Some measured days and some invented days inside one number is worse than
  // staying visibly synthetic.
  assert.match(result.summary.reason ?? "", /1 of 3 day/);
});

test("full coverage replaces sessions and the browsing funnel with real GA4 data", () => {
  const rows = ["2026-09-01", "2026-09-02", "2026-09-03"].map((date) => ga4Row(date));
  const result = applyGa4Hydration(snapshot(), rows);

  assert.equal(result.summary.hydrated, true);
  assert.equal(result.summary.coveredDays, 3);

  const sessions = result.snapshot.kpis.find((kpi) => kpi.key === "sessions");
  assert.equal(sessions?.value, 300);

  const funnel = result.snapshot.conversionFunnel;
  assert.equal(funnel[0].sessions, 300);
  assert.equal(funnel[1].sessions, 75);
  assert.equal(funnel[2].sessions, 30);
  assert.equal(funnel[3].sessions, 15);
  // Step rates come from the steps themselves, not from the fixture they replaced.
  assert.equal(Math.round(funnel[1].rateFromEntry * 100) / 100, 0.25);
  assert.equal(Math.round((funnel[2].rateFromPreviousStep ?? 0) * 100) / 100, 0.4);
  // The first step has no previous step, so its rate is withheld, not faked as 1.
  assert.equal(funnel[0].rateFromPreviousStep, null);
});

test("hydration replaces traffic and leaves store revenue alone", () => {
  const base = snapshot();
  const rows = ["2026-09-01", "2026-09-02", "2026-09-03"].map((date) => ga4Row(date));
  const result = applyGa4Hydration(base, rows);

  // GA4 measures sessions; The store knows orders and money. Letting GA4 revenue
  // overwrite store revenue would replace the ground truth with an estimate.
  assert.deepEqual(result.snapshot.salesOverTime, base.salesOverTime);
  assert.deepEqual(result.snapshot.rfm, base.rfm);
  assert.equal(
    result.snapshot.kpis.find((kpi) => kpi.key === "grossSales")?.value,
    base.kpis.find((kpi) => kpi.key === "grossSales")?.value,
  );
  // The store source is still store fixtures, so the mode marker must not flip.
  assert.equal(result.snapshot.mode, "dummy");
});

test("a device breakdown becomes a share row set with the full contract", () => {
  const rows = ["2026-09-01", "2026-09-02", "2026-09-03"].flatMap((date) => [
    ga4Row(date),
    ga4Row(date, { breakdown: "device", breakdownValue: "Mobile", sessions: 70 }),
    ga4Row(date, { breakdown: "device", breakdownValue: "Desktop", sessions: 30 }),
  ]);
  const result = applyGa4Hydration(snapshot(), rows);
  const devices = result.snapshot.sessionsByDevice;

  assert.equal(devices[0].label, "Mobile");
  assert.equal(devices[0].value, 210);
  assert.equal(Math.round(devices[0].share * 100) / 100, 0.7);
  assert.ok(devices.every((row) => typeof row.key === "string" && row.key.length > 0));
  assert.ok(devices.every((row) => "previousValue" in row));
});

test("the store page hydrates through a guard that cannot break the render", async () => {
  const pageSource = await readFile(
    new URL("../src/app/store-analytics/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(pageSource, /readGa4DailyMetrics\(/);
  assert.match(pageSource, /applyGa4Hydration\(/);
  // An unreachable database must leave the page on synthetic data, not 500.
  assert.match(pageSource, /catch \{[\s\S]{0,200}\}/);
  assert.match(pageSource, /let storeSnapshot = syntheticSnapshot;/);
});
