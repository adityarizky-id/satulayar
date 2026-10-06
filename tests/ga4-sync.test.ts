import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { afterEach } from "node:test";

import { GA4_SYNC_BREAKDOWNS, persistGa4Sync } from "@/lib/connectors/ga4-sync";

const ORIGINAL_PROPERTY = process.env.GA4_PROPERTY_ID;
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (ORIGINAL_PROPERTY === undefined) delete process.env.GA4_PROPERTY_ID;
  else process.env.GA4_PROPERTY_ID = ORIGINAL_PROPERTY;
});

test("an unconfigured GA4 skips rather than failing the whole refresh", async () => {
  delete process.env.GA4_PROPERTY_ID;
  let reachedNetwork = false;
  globalThis.fetch = (async () => {
    reachedNetwork = true;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  const result = await persistGa4Sync({
    clientId: "00000000-0000-0000-0000-000000000000",
    range: { start: "2026-09-01", end: "2026-09-07" },
    currency: "GBP",
  });

  // Waiting for consent is a known state, not an incident. Failing here would
  // turn every scheduled ads refresh red until the operator's device is used.
  assert.equal(result.outcome, "skipped");
  assert.equal(result.rowsUpserted, 0);
  assert.match(result.safeMessage, /not configured/i);
  assert.equal(reachedNetwork, false);
});

test("a GA4 grant that cannot authenticate skips without touching the database", async () => {
  process.env.GA4_PROPERTY_ID = "123456789";
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("oauth2.googleapis.com/token")) {
      return new Response('{"error":"invalid_grant"}', { status: 400 });
    }
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  const result = await persistGa4Sync({
    clientId: "00000000-0000-0000-0000-000000000000",
    range: { start: "2026-09-01", end: "2026-09-07" },
    currency: "GBP",
  });

  assert.equal(result.outcome, "skipped");
  assert.match(result.safeMessage, /GA4 was not read/);
});

test("the sync stores every breakdown the dashboard reads", () => {
  assert.deepEqual(GA4_SYNC_BREAKDOWNS, [
    "total",
    "channel",
    "device",
    "landingPage",
    "country",
  ]);
});

test("GA4 rows are upserted on the table unique key, so a repeat corrects a day", async () => {
  const source = await readFile(
    new URL("../src/lib/connectors/ga4-sync.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /onConflict:\s*\n?\s*"metric_date,client_id,property_id,breakdown,breakdown_value,source_query_version"/,
  );
  // The bounce rate column is constrained to 0..1; a rounded 1.0000001 from
  // GA4 would otherwise reject the whole batch and lose the day.
  assert.match(source, /Math\.min\(Math\.max\(row\.bounceRate, 0\), 1\)/);
});

test("a GA4 failure never discards an advertising refresh that already landed", async () => {
  const [cronSource, backfillSource] = await Promise.all([
    readFile(new URL("../src/app/api/cron/daily-sync/route.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../src/app/api/connectors/backfill/route.ts", import.meta.url),
      "utf8",
    ),
  ]);

  for (const source of [cronSource, backfillSource]) {
    assert.match(source, /persistGa4Sync\(/);
    // Reported beside the ads result, not merged into it.
    assert.match(source, /ga4: \{/);
    assert.match(source, /ga4Outcome: ga4\.outcome/);
  }
});
