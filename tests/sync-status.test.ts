import assert from "node:assert/strict";
import test from "node:test";

import {
  latestSyncTimestamp,
  syncCompletionTimestamp,
} from "../src/lib/dashboard/sync-status";
import type { SyncJob } from "../src/lib/dashboard/types";

function job(overrides: Partial<SyncJob> = {}): SyncJob {
  return {
    id: "mock-job",
    status: "succeeded",
    requestedRange: { start: "2026-07-01", end: "2026-07-14" },
    platforms: ["meta", "google"],
    createdAt: "2026-08-05T09:00:00.000Z",
    updatedAt: "2026-08-05T09:00:03.000Z",
    safeMessage: "Fixture refresh complete.",
    ...overrides,
  };
}

test("the newest timestamp wins regardless of the order given", () => {
  assert.equal(
    latestSyncTimestamp("2026-07-17T05:45:00.000Z", "2026-08-05T09:00:03.000Z"),
    "2026-08-05T09:00:03.000Z",
  );
  assert.equal(
    latestSyncTimestamp("2026-08-05T09:00:03.000Z", "2026-07-17T05:45:00.000Z"),
    "2026-08-05T09:00:03.000Z",
  );
});

test("empty, null, and unparseable values never become a sync time", () => {
  assert.equal(latestSyncTimestamp(null, undefined, ""), null);
  assert.equal(latestSyncTimestamp("not-a-date"), null);
  assert.equal(
    latestSyncTimestamp(null, "not-a-date", "2026-08-05T09:00:00.000Z"),
    "2026-08-05T09:00:00.000Z",
  );
});

test("a finished or partially published job stamps the moment it completed", () => {
  assert.equal(syncCompletionTimestamp(job()), "2026-08-05T09:00:03.000Z");
  assert.equal(
    syncCompletionTimestamp(job({ status: "partial" })),
    "2026-08-05T09:00:03.000Z",
  );
});

test("a job still running does not move the marker", () => {
  assert.equal(syncCompletionTimestamp(job({ status: "syncing" })), null);
  assert.equal(syncCompletionTimestamp(job({ status: "queued" })), null);
  assert.equal(syncCompletionTimestamp(job({ status: "failed" })), null);
  assert.equal(syncCompletionTimestamp(null), null);
});

test("a refresh that lands after the stored snapshot moves the marker forward", () => {
  const storedSnapshotSync = "2026-07-17T05:45:00.000Z";
  const finished = job({ updatedAt: "2026-08-05T09:12:00.000Z" });

  assert.equal(
    latestSyncTimestamp(
      storedSnapshotSync,
      storedSnapshotSync,
      syncCompletionTimestamp(finished),
    ),
    "2026-08-05T09:12:00.000Z",
  );
});

test("a stale job never drags the marker backwards", () => {
  const alreadyKnown = "2026-08-05T09:30:00.000Z";
  const older = job({ updatedAt: "2026-08-05T09:00:00.000Z" });

  assert.equal(
    latestSyncTimestamp(alreadyKnown, syncCompletionTimestamp(older)),
    alreadyKnown,
  );
});
