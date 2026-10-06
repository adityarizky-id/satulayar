import assert from "node:assert/strict";
import test from "node:test";

import {
  ACCOUNT_COOKIE,
  ACCOUNT_OPTIONS,
  ADVERTISING_PLATFORM_CATALOG,
  DEFAULT_ACCOUNT_SLUG,
  resolveAccount,
  resolvePlatformForAccount,
} from "../src/lib/dashboard/accounts";
import {
  buildDashboardSnapshot,
  getFixtureRowsForAccount,
} from "../src/lib/dashboard/fixtures";
import {
  matchTimeframe,
  PREVIEW_REFERENCE_DATE,
  resolveTimeframe,
  TIMEFRAME_PRESETS,
} from "../src/lib/dashboard/timeframes";
import { buildStoreAnalyticsSnapshot, storeForAccount } from "../src/lib/store/analytics";

test("the account catalogue covers the five demo brands without exposing identifiers", () => {
  assert.equal(ACCOUNT_OPTIONS.length, 5);
  assert.equal(resolveAccount(DEFAULT_ACCOUNT_SLUG).name, "Kopi Senja Nusantara");
  assert.equal(ACCOUNT_COOKIE, "sl_account");

  for (const account of ACCOUNT_OPTIONS) {
    assert.equal(account.platforms.length > 0, true);
    assert.match(account.slug, /^[a-z0-9-]+$/);
    // No numeric advertising or store account ids may leak into the repo.
    assert.doesNotMatch(JSON.stringify(account), /\d{6,}/);
  }
});

test("an unknown or missing account falls back to the pilot brand", () => {
  assert.equal(resolveAccount(null).slug, DEFAULT_ACCOUNT_SLUG);
  assert.equal(resolveAccount("does-not-exist").slug, DEFAULT_ACCOUNT_SLUG);
});

test("a brand cannot be filtered by a platform it does not run", () => {
  const batik = resolveAccount("batik-lestari");
  const kopiSenja = resolveAccount("kopi-senja");

  assert.deepEqual(batik.platforms, ["google"]);
  assert.equal(resolvePlatformForAccount(batik, "all"), "google");
  assert.equal(resolvePlatformForAccount(batik, "meta"), "google");
  assert.equal(resolvePlatformForAccount(batik, "google"), "google");
  assert.equal(resolvePlatformForAccount(kopiSenja, "meta"), "meta");
});

test("each brand reads at its own volume, currency, and platform set", () => {
  const kopiSenjaRows = getFixtureRowsForAccount(resolveAccount("kopi-senja"));
  const batikRows = getFixtureRowsForAccount(resolveAccount("batik-lestari"));
  const kriyaRows = getFixtureRowsForAccount(resolveAccount("kriya-bali"));

  assert.equal(
    batikRows.every((row) => row.platform === "google"),
    true,
  );
  assert.equal(
    batikRows.every((row) => row.currency === "USD"),
    true,
  );
  assert.equal(
    kopiSenjaRows.every((row) => row.accountTimezone === "Asia/Jakarta"),
    true,
  );

  const spendOf = (rows: typeof kopiSenjaRows) =>
    rows
      .filter((row) => row.date === "2026-07-01" && row.platform === "google")
      .reduce((total, row) => total + row.spend, 0);

  assert.equal(spendOf(kriyaRows) > spendOf(kopiSenjaRows), true);
  assert.equal(spendOf(batikRows) < spendOf(kopiSenjaRows), true);
});

test("the snapshot follows the selected brand's currency and timezone", () => {
  const kriya = resolveAccount("kriya-bali");
  const snapshot = buildDashboardSnapshot(
    { start: "2026-07-01", end: "2026-07-14" },
    "all",
    kriya,
  );

  assert.equal(snapshot.account.name, "Kriya Bali");
  assert.equal(snapshot.account.currency, "USD");
  assert.match(snapshot.account.timezone, /Asia\/Makassar/);
  assert.equal(snapshot.guardrail.currency, "USD");
  assert.equal(snapshot.dataStatus, "ready");
});

test("the store follows the same brand as the paid dashboard", () => {
  const jamu = resolveAccount("jamu-alami");
  const snapshot = buildStoreAnalyticsSnapshot(
    { start: "2026-07-01", end: "2026-07-14" },
    { store: storeForAccount(jamu), scale: jamu.fixtureScale },
  );

  assert.equal(snapshot.store.name, "Jamu Alami store");
  assert.equal(snapshot.store.currency, "USD");
  assert.equal(snapshot.store.timezone, "Asia/Jakarta");
  assert.match(snapshot.currencyNote, /USD/);
});

test("every timeframe preset resolves to a range that ends on the reference day", () => {
  for (const preset of TIMEFRAME_PRESETS) {
    const range = resolveTimeframe(preset.key);
    assert.notEqual(range, null);
    if (!range) continue;
    assert.equal(range.start <= range.end, true);
  }

  assert.deepEqual(resolveTimeframe("7d"), {
    start: "2026-07-08",
    end: PREVIEW_REFERENCE_DATE,
  });
  assert.deepEqual(resolveTimeframe("1y"), {
    start: "2025-07-15",
    end: PREVIEW_REFERENCE_DATE,
  });
  assert.deepEqual(resolveTimeframe("all-time"), {
    start: "2024-01-01",
    end: PREVIEW_REFERENCE_DATE,
  });
});

test("the running year stops at the reference day and past years are complete", () => {
  assert.deepEqual(resolveTimeframe("2026"), {
    start: "2026-01-01",
    end: PREVIEW_REFERENCE_DATE,
  });
  assert.deepEqual(resolveTimeframe("2025"), {
    start: "2025-01-01",
    end: "2025-12-31",
  });
  assert.equal(resolveTimeframe("2027"), null);
  assert.equal(resolveTimeframe("nonsense"), null);
});

test("a preset range is recognised again and a custom range is not", () => {
  assert.equal(matchTimeframe({ start: "2026-07-08", end: "2026-07-14" }), "7d");
  assert.equal(matchTimeframe({ start: "2026-01-01", end: "2026-07-14" }), "2026");
  assert.equal(matchTimeframe({ start: "2024-01-01", end: "2026-07-14" }), "all-time");
  assert.equal(matchTimeframe({ start: "2026-07-02", end: "2026-07-11" }), null);
});

test("TikTok Ads and Microsoft Advertising are prepared as planned without becoming queryable", () => {
  const tiktok = ADVERTISING_PLATFORM_CATALOG.find(
    (platform) => platform.id === "tiktok",
  );
  const microsoft = ADVERTISING_PLATFORM_CATALOG.find(
    (platform) => platform.id === "microsoft",
  );

  assert.deepEqual(tiktok, {
    id: "tiktok",
    label: "TikTok Ads",
    shortLabel: "TikTok",
    availability: "planned",
  });
  assert.deepEqual(microsoft, {
    id: "microsoft",
    label: "Microsoft Ads (Bing)",
    shortLabel: "Microsoft",
    availability: "planned",
  });
  assert.equal(JSON.stringify(ACCOUNT_OPTIONS).includes('"tiktok"'), false);
  assert.equal(JSON.stringify(ACCOUNT_OPTIONS).includes('"microsoft"'), false);
});

test("the dashboard comparison window is global and honest about its basis", () => {
  const account = resolveAccount("kopi-senja");
  const range = { start: "2026-07-01", end: "2026-07-14" };
  const previous = buildDashboardSnapshot(
    range,
    "all",
    account,
    undefined,
    undefined,
    undefined,
    "previous",
  );
  const thirtyDayBaseline = buildDashboardSnapshot(
    range,
    "all",
    account,
    undefined,
    undefined,
    undefined,
    "30d",
  );
  const previousYear = buildDashboardSnapshot(
    range,
    "all",
    account,
    undefined,
    undefined,
    undefined,
    "previous-year",
  );

  assert.deepEqual(thirtyDayBaseline.comparisonRange, {
    start: "2026-06-01",
    end: "2026-06-30",
  });
  assert.deepEqual(thirtyDayBaseline.comparisonBasis, {
    label: "Last 30 days",
    activeDays: 14,
    comparisonDays: 30,
    normalisedToActiveDuration: true,
  });
  assert.equal(previous.comparisonBasis.normalisedToActiveDuration, false);
  assert.equal(previousYear.comparisonBasis.normalisedToActiveDuration, false);
  assert.notEqual(
    thirtyDayBaseline.comparisonTotals.spend,
    previous.comparisonTotals.spend,
  );
  assert.equal(
    thirtyDayBaseline.searchTerms?.comparisonRange.start,
    "2026-06-01",
  );
  assert.equal(thirtyDayBaseline.geo?.comparisonRange?.start, "2026-06-01");
});

test("preview fixtures reach back far enough for the year presets", () => {
  const range2024 = resolveTimeframe("2024");
  assert.notEqual(range2024, null);
  if (!range2024) return;

  const snapshot = buildDashboardSnapshot(range2024, "all");

  assert.equal(snapshot.dataStatus !== "blocked", true);
  assert.equal(snapshot.totals.spend > 0, true);
});

test("preview fixtures include the requested 11 August running period", () => {
  const snapshot = buildDashboardSnapshot(
    { start: "2026-08-01", end: "2026-08-11" },
    "all",
  );

  assert.equal(snapshot.totals.spend > 0, true);
  assert.equal(snapshot.trend.at(-1)?.date, "2026-08-11");
  assert.equal(snapshot.dataStatus !== "blocked", true);
});
