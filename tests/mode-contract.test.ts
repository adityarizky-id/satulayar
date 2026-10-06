import assert from "node:assert/strict";
import test from "node:test";

import {
  DASHBOARD_DATA_MODE_BEHAVIOR,
  DASHBOARD_DATA_MODE_QUERY_PARAM,
  DASHBOARD_DATA_MODE_STORAGE_KEY,
  createDashboardDataModeState,
  isDashboardDataDisplayMode,
  resolveDashboardDataDisplayMode,
  serializeDashboardDataDisplayMode,
  serializeDashboardDataModeStorage,
  transitionDashboardDataMode,
  validateDashboardDataDisplayMode,
  withDashboardDataDisplayMode,
} from "@/lib/dashboard/mode-contract";

test("the display-mode validator accepts only live and dummy", () => {
  assert.equal(isDashboardDataDisplayMode("live"), true);
  assert.equal(isDashboardDataDisplayMode("dummy"), true);
  assert.equal(isDashboardDataDisplayMode("mock"), false);
  assert.equal(validateDashboardDataDisplayMode(" DUMMY "), "dummy");
  assert.equal(validateDashboardDataDisplayMode("preview"), null);
  assert.equal(validateDashboardDataDisplayMode(null), null);
});

test("URL state outranks local storage and local storage is the fallback", () => {
  assert.deepEqual(
    resolveDashboardDataDisplayMode({
      urlSearch: "?dataMode=dummy",
      localStorageValue: "live",
    }),
    { mode: "dummy", source: "url" },
  );

  assert.deepEqual(
    resolveDashboardDataDisplayMode({
      urlSearch: "?dataMode=invalid",
      localStorageValue: "dummy",
    }),
    { mode: "dummy", source: "local-storage" },
  );

  assert.deepEqual(resolveDashboardDataDisplayMode({}), {
    mode: "live",
    source: "default",
  });
});

test("mode state serializes to the URL and the versioned storage key", () => {
  assert.equal(serializeDashboardDataDisplayMode("dummy"), "?dataMode=dummy");
  assert.equal(
    withDashboardDataDisplayMode("?account=kopi-senja&range=30d", "live"),
    "?account=kopi-senja&range=30d&dataMode=live",
  );
  assert.deepEqual(serializeDashboardDataModeStorage("dummy"), {
    key: DASHBOARD_DATA_MODE_STORAGE_KEY,
    value: "dummy",
  });
  assert.equal(DASHBOARD_DATA_MODE_QUERY_PARAM, "dataMode");
});

test("the state machine toggles, selects, resets, and tracks revisions", () => {
  const initial = createDashboardDataModeState({ localStorageValue: "dummy" });
  assert.deepEqual(initial, {
    mode: "dummy",
    source: "local-storage",
    revision: 0,
  });

  const toggled = transitionDashboardDataMode(initial, { type: "toggle" });
  assert.deepEqual(toggled, { mode: "live", source: "url", revision: 1 });

  const selected = transitionDashboardDataMode(toggled, {
    type: "select",
    mode: "dummy",
  });
  assert.deepEqual(selected, { mode: "dummy", source: "url", revision: 2 });

  const reset = transitionDashboardDataMode(selected, { type: "reset" });
  assert.deepEqual(reset, { mode: "live", source: "url", revision: 3 });
});

test("hydration is idempotent when the resolved state did not change", () => {
  const state = createDashboardDataModeState({ urlSearch: "?dataMode=live" });
  const hydrated = transitionDashboardDataMode(state, {
    type: "hydrate",
    urlSearch: "?dataMode=live",
    localStorageValue: "dummy",
  });
  assert.equal(hydrated, state);
});

test("live mode binds every topbar action to live evidence", () => {
  const behavior = DASHBOARD_DATA_MODE_BEHAVIOR.live;
  assert.deepEqual(behavior.refresh, {
    effect: "sync-live-connectors",
    requiresSyncPermission: true,
    label: "Refresh data",
  });
  assert.equal(behavior.syncTimePill.source, "latest-persisted-sync");
  assert.equal(behavior.statusDot.source, "live-data-health");
  assert.equal(behavior.rangePicker.effect, "query-live-range");
  assert.equal(behavior.anomalyAlert.policy, "validated-live-only");
  assert.equal(behavior.anomalyAlert.suppressWhenProvisional, true);
});

test("dummy mode is interactive but cannot sync or emit operational alerts", () => {
  const behavior = DASHBOARD_DATA_MODE_BEHAVIOR.dummy;
  assert.equal(behavior.refresh.effect, "regenerate-dummy-snapshot");
  assert.equal(behavior.refresh.requiresSyncPermission, false);
  assert.equal(behavior.syncTimePill.source, "snapshot-generated-at");
  assert.equal(behavior.statusDot.label, "Dummy data");
  assert.equal(behavior.rangePicker.effect, "rebuild-dummy-range");
  assert.equal(behavior.anomalyAlert.policy, "simulation-only");
  assert.equal(behavior.anomalyAlert.actionable, false);
});
