import assert from "node:assert/strict";
import test from "node:test";

import { GoogleAdsApiClient } from "@/lib/connectors/google-ads-api-client";
import { MetaAdsApiClient } from "@/lib/connectors/meta-ads-api-client";
import { SyncPipeline } from "@/lib/connectors/sync-pipeline";

test("GoogleAdsApiClient reports unauthenticated when credentials are missing", async () => {
  const client = new GoogleAdsApiClient({});
  const health = await client.health();
  assert.equal(health.available, false);
  assert.equal(health.authenticated, false);
  assert.equal(health.readOnly, true);
});

test("MetaAdsApiClient reports unauthenticated when credentials are missing", async () => {
  const client = new MetaAdsApiClient({});
  const health = await client.health();
  assert.equal(health.available, false);
  assert.equal(health.authenticated, false);
  assert.equal(health.readOnly, true);
});

test("SyncPipeline fails closed in live mode when direct API is unconfigured", async () => {
  const pipeline = new SyncPipeline();
  const result = await pipeline.runSync({
    clientId: "pilot-client",
    accountKey: "kopi-senja-usd",
    range: { start: "2026-08-01", end: "2026-08-07" },
    platforms: ["meta", "google"],
    mode: "live",
  });

  assert.equal(result.status, "failed");
  assert.equal(result.dataStatus, "blocked");
  assert.equal(result.recordsProcessed, 0);
  assert.ok(result.errors.length > 0);
});

test("SyncPipeline succeeds in mock mode", async () => {
  const pipeline = new SyncPipeline();
  const result = await pipeline.runSync({
    clientId: "pilot-client",
    accountKey: "kopi-senja-usd",
    range: { start: "2026-08-01", end: "2026-08-07" },
    platforms: ["meta", "google"],
    mode: "mock",
  });

  assert.equal(result.status, "succeeded");
  assert.equal(result.dataStatus, "ready");
  assert.ok(result.recordsProcessed > 0);
  assert.ok(result.rows.length > 0);
});
